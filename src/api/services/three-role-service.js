const crypto = require('node:crypto');
const { ThreeRoleRepository } = require('../../db/repositories/three-role-repository');
const { ValidationError, ForbiddenError, UnauthorizedError, NotFoundError, ConflictError, InvalidStateTransitionError } = require('../errors');
const v = require('./workflow-input');
const editable = new Set(['DRAFT','NEEDS_REVISION']);
const stable = x => JSON.stringify(x, function (_key, value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k,value[k]])) : value;
});
function version(actual, expected) { if (Number(actual) !== expected) throw new ConflictError('ข้อมูลเปลี่ยนแล้ว กรุณารีเฟรชก่อนทำรายการ', 'STALE_RECORD_CONFLICT'); }
function staff(actor) { if (actor.role !== 'STAFF') throw new ForbiddenError(); }
function student(actor) { if (actor.role !== 'STUDENT') throw new ForbiddenError(); }
class ThreeRoleService {
  constructor(options = {}) { this.repository = options.threeRoleRepository || new ThreeRoleRepository(options); }
  async transaction(actor, task) {
    if (!actor?.isAuthenticated || !actor.userId) throw new UnauthorizedError();
    const r = this.repository, c = await r.getClient();
    try {
      await c.query('BEGIN');
      const current = await r.actor(c,actor.userId);
      if (!current || current.role !== actor.role || current.account_status !== 'ACTIVE' || !['STUDENT','STAFF','ADVISOR'].includes(actor.role)) throw new ForbiddenError();
      const result = await task(c,r);
      await c.query('COMMIT'); return result;
    } catch (error) {
      await c.query('ROLLBACK');
      if (['23505','23P01','40P01','40001'].includes(error.code) || error.constraint === 'advisor_capacity_five') {
        throw new ConflictError(error.constraint === 'advisor_capacity_five' ? 'อาจารย์ดูแลนักศึกษาในช่วงเวลานี้ครบ 5 คนแล้ว' : 'รายการชนกับข้อมูลที่มีอยู่ กรุณารีเฟรชแล้วลองใหม่');
      }
      throw error;
    } finally { c.release(); }
  }
  async plan(c, actor, id, lock = false) {
    v.uuid(id,'plan_id');
    const r = this.repository, p = await r.plan(c,id,lock);
    if (!p) { if (actor.role === 'ADVISOR') throw new ForbiddenError(); throw new NotFoundError(); }
    if (actor.role === 'STUDENT' && (p.student_id !== actor.studentId || p.student_user_id !== actor.userId)) throw new ForbiddenError();
    if (actor.role === 'STAFF') {
      const scopes = await r.scopes(c,actor.userId);
      if (!scopes.some(s => s.department === p.department && (!s.program || s.program === p.program) && (!s.academic_year || s.academic_year === p.academic_year))) throw new ForbiddenError();
    }
    if (actor.role === 'ADVISOR' && !await r.assigned(c,actor.userId,p.student_id)) throw new ForbiddenError();
    return p;
  }
  async write(c, actor, action, resource, body, task, planId = null) {
    v.command(body);
    const r = this.repository;
    // Serialize retries across resources. Callers authorize their locked resource first.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workflow:${body.operation_id}`]);
    const hash = crypto.createHash('sha256').update(stable(body)).digest('hex');
    const prior = await r.receipt(c,body.operation_id);
    if (prior) {
      if (prior.actor_id !== actor.userId || prior.action !== action || prior.resource_id !== resource || prior.request_hash !== hash) throw new ConflictError('Operation ID already used.', 'IDEMPOTENCY_KEY_REUSED');
      return { ...prior.result, idempotent_replay: true };
    }
    const result = await task();
    await r.record(c,actor,action,resource,body,hash,result,planId);
    return result;
  }
  async getWorkflow(actor,id) {
    return this.transaction(actor,async (c,r) => {
      const p = await this.plan(c,actor,id);
      const policy = await r.policy(c,p), extras = await r.planExtras(c,p);
      return { plan_id: p.id, student_id: p.student_id, student_number: p.student_number,
        cycle_id: p.cycle_id, cycle_status: p.cycle_status, status: p.status, version: p.version, project_title: p.project_title,
        references: p.document_references, policy, legacy_submission: extras.submissions.length === 0 && p.status !== 'DRAFT',
        ...extras };
    });
  }
  async saveWorkflow(actor,id,body) {
    student(actor); v.fields(body,['project_title','references','policy_id','expected_version','operation_id']);
    const project = v.text(body.project_title,'project_title',300);
    const refs = v.references(body.references); v.uuid(body.policy_id,'policy_id');
    return this.transaction(actor,async (c,r) => {
      const p = await this.plan(c,actor,id,true);
      return this.write(c,actor,'references:save',id,body,async () => {
        if (!editable.has(p.status)) throw new InvalidStateTransitionError();
        version(p.version,body.expected_version);
        const policy = await r.policy(c,p);
        if (!policy || policy.id !== body.policy_id) throw new ConflictError('ข้อกำหนดเอกสารเปลี่ยนแล้ว กรุณารีเฟรช');
        v.validateReferences(policy,refs,p.student_number);
        return r.saveReferences(c,p,{ project_title: project,references: refs,policy_id: policy.id });
      },p.id);
    });
  }
  async saveContact(actor,body) {
    student(actor); v.fields(body,['contact_address','contact_phone','version','operation_id']);
    if(!Object.hasOwn(body,'contact_address')&&!Object.hasOwn(body,'contact_phone'))throw new ValidationError('กรุณาระบุข้อมูลติดต่อที่ต้องการแก้ไข');
    let address=body.contact_address;
    if(address!=null) {
      if(typeof address!=='string'||address.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(address))throw new ValidationError('กรุณาระบุที่อยู่ไม่เกิน 1000 ตัวอักษร');
      address=address.replaceAll('\r\n','\n').trim()||null;
    }
    const phone=v.text(body.contact_phone,'contact_phone',40,false);
    if (phone && (!/^[+()\d .-]{5,40}$/.test(phone)||!/\d/.test(phone))) throw new ValidationError('กรุณาตรวจสอบรูปแบบเบอร์โทรศัพท์');
    return this.transaction(actor,async (c,r) => {
      const s=await r.one(c,'SELECT id,user_id,version,contact_address,contact_phone FROM students WHERE id=$1 FOR UPDATE',[actor.studentId]);
      if (!s || s.user_id !== actor.userId) throw new ForbiddenError();
      return this.write(c,actor,'contact:save',s.id,{...body,expected_version:body.version},async () => {
        version(s.version,body.version);
        const updated=await r.contact(c,actor,Object.hasOwn(body,'contact_address')?address:s.contact_address,Object.hasOwn(body,'contact_phone')?phone:s.contact_phone);
        return require('./student-profile-service').toStudentSelfProfile(updated);
      });
    });
  }
  async dashboard(actor) {
    staff(actor);
    return this.transaction(actor,async (c,r) => {
      const scopes = await r.scopes(c,actor.userId);
      if (!scopes.length) throw new ForbiddenError();
      return r.staffDashboard(c,actor,scopes);
    });
  }
  async publish(actor,body) {
    staff(actor); v.fields(body,['cycle_id','department','program','requirements','expected_version','operation_id']);
    const cycleId = v.uuid(body.cycle_id,'cycle_id'), department = v.text(body.department,'department',200);
    const program = v.text(body.program,'program',200,false) || '', requirements = v.requirements(body.requirements);
    return this.transaction(actor,async (c,r) => {
      const scopes = await r.scopes(c,actor.userId);
      const cycle = await r.one(c,'SELECT academic_year,status FROM rounds WHERE id=$1',[cycleId]);
      if (!cycle || !scopes.some(s => s.department === department && (!s.program || s.program === program) && (!s.academic_year || s.academic_year === cycle.academic_year))) throw new ForbiddenError();
      if (cycle.status !== 'OPEN') throw new InvalidStateTransitionError('รอบสมัครปิดแล้ว');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`policy:${cycleId}:${department}:${program}`]);
      return this.write(c,actor,'policy:publish',cycleId,body,async () => {
        const prev = await r.latestPolicy(c,{ cycle_id: cycleId,department,program });
        version(prev?.version || 0,body.expected_version);
        return r.publish(c,actor,{...body,cycle_id: cycleId,department,program,requirements,id: crypto.randomUUID()});
      });
    });
  }
  async listAssignments(actor,filters={}) {
    staff(actor);v.fields(filters,['page','pageSize','advisor_id']);
    const page=Number(filters.page||1),pageSize=Number(filters.pageSize||20);
    if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new ValidationError('Invalid assignment pagination.');
    const advisorId=filters.advisor_id ? v.uuid(filters.advisor_id,'advisor_id') : null;
    return this.transaction(actor,async(c,r)=>{
      if(!(await r.scopes(c,actor.userId)).length)throw new ForbiddenError();
      return r.listAssignments(c,actor,{page,pageSize,advisorId});
    });
  }
  async assign(actor,body) {
    staff(actor); v.fields(body,['plan_id','advisor_id','effective_to','expected_version','operation_id','reason']);
    v.uuid(body.plan_id,'plan_id'); v.uuid(body.advisor_id,'advisor_id');
    return this.transaction(actor,async (c,r) => {
      const p = await this.plan(c,actor,body.plan_id,true);
      return this.write(c,actor,'assignment:create',p.id,body,async () => {
        version(p.version,body.expected_version);
        return this.createAssignment(c,actor,p,body);
      },p.id);
    });
  }
  async createAssignment(c,actor,p,body) {
    const r = this.repository;
    if (p.status !== 'APPROVED') throw new InvalidStateTransitionError('ต้องอนุมัติคุณสมบัติก่อนมอบหมายอาจารย์');
    const end = new Date(body.effective_to);
    if (!body.effective_to || !Number.isFinite(end.getTime()) || end <= new Date()) throw new ValidationError('กรุณาระบุวันสิ้นสุดการดูแลในอนาคต');
    if (!p.semester) throw new ValidationError('รอบสมัครยังไม่มีข้อมูลภาคการศึกษา');
    // Student row serializes create/reassign across different approved plans.
    await c.query('SELECT id FROM students WHERE id=$1 FOR UPDATE',[p.student_id]);
    const advisors = await r.lockAdvisors(c,[v.uuid(body.advisor_id,'advisor_id')]);
    if (advisors[0]?.role !== 'ADVISOR' || advisors[0]?.account_status !== 'ACTIVE') throw new ForbiddenError();
    return r.createAssignment(c,actor,p,{...body,effective_to: end.toISOString(),id: crypto.randomUUID()});
  }
  async changeAssignment(actor,id,body,reassign = false) {
    staff(actor); v.uuid(id,'assignment_id');
    v.fields(body,reassign ? ['advisor_id','effective_to','reason','expected_version','operation_id'] : ['reason','expected_version','operation_id']);
    const reason = v.text(body.reason,'reason',2000);
    return this.transaction(actor,async (c,r) => {
      let a = await r.assignment(c,id);
      if (!a) throw new ForbiddenError();
      const linkedPlan=a.plan_id ? await this.plan(c,actor,a.plan_id,true) : null;
      a=await r.assignment(c,id,true);
      // Legacy assignments have no trustworthy plan link. Scope by their own academic period.
      const scopes = await r.scopes(c,actor.userId);
      const s = await r.one(c,'SELECT department,program FROM students WHERE id=$1 FOR UPDATE',[a.student_id]);
      if (!s || !scopes.some(sc => sc.department === s.department && (!sc.program || sc.program === s.program) && (!sc.academic_year || sc.academic_year === a.academic_year))) throw new ForbiddenError();
      return this.write(c,actor,reassign ? 'assignment:reassign' : 'assignment:revoke',id,body,async () => {
        version(a.version,body.expected_version);
        if (a.status !== 'ACTIVE') throw new InvalidStateTransitionError();
        await r.lockAdvisors(c,[a.advisor_id,...(reassign ? [v.uuid(body.advisor_id,'advisor_id')] : [])]);
        const old = await r.revoke(c,actor,a,reason);
        if (!reassign) return old;
        if (!a.plan_id) throw new InvalidStateTransitionError('รายการเดิมไม่มีแผนที่อนุมัติอ้างอิง ให้ยกเลิกแล้วมอบหมายจากแผนที่อนุมัติ');
        const next = await this.createAssignment(c,actor,linkedPlan,body);
        return {...next, previous_assignment_id: a.id};
      },a.plan_id);
    });
  }
  async placement(actor,id,action,body) {
    const own = ['save','submit'].includes(action);
    if (own) student(actor); else staff(actor);
    const payloadKeys = ['company_id','company_name','position_title','project_title','accepted'];
    const extra = action === 'save' ? payloadKeys : action === 'mark-sent' ? ['reference'] : action === 'confirm' ? ['company_name','student_number','reference','url'] : action === 'return' ? ['reason'] : [];
    v.fields(body,['expected_version','operation_id',...extra]);
    return this.transaction(actor,async (c,r) => {
      const p = await this.plan(c,actor,id,true);
      return this.write(c,actor,`placement:${action}`,id,body,async () => {
        if (p.status !== 'APPROVED') throw new InvalidStateTransitionError('ต้องผ่านเกณฑ์สหกิจก่อนแจ้งผลตอบรับบริษัท');
        const current = (await r.planExtras(c,p)).placement || {version:0,status:'DRAFT',payload:{}};
        version(current.version,body.expected_version);
        const next = {...current,version:current.version+1};
        if (action === 'save') {
          if (!editable.has(current.status)) throw new InvalidStateTransitionError();
          if (body.accepted !== true) throw new ValidationError('กรุณายืนยันว่าบริษัทตอบรับและคุณตกลงแล้ว');
          next.payload = {company_id:body.company_id ? v.uuid(body.company_id,'company_id') : null,
            company_name:v.text(body.company_name,'company_name',300),position_title:v.text(body.position_title,'position_title',300),
            project_title:v.text(body.project_title,'project_title',300),accepted:true};
          if (next.payload.company_id && !await r.one(c,'SELECT id FROM companies WHERE id=$1',[next.payload.company_id])) throw new ValidationError('Unknown company.');
        } else if (action === 'submit') {
          if (!editable.has(current.status) || !current.payload.accepted) throw new InvalidStateTransitionError();
          next.status='SUBMITTED'; next.submitted_payload={...current.payload}; next.feedback=null;
          next.sent_at=null; next.sent_reference=null; next.evidence=null; next.confirmed_at=null; next.confirmed_by=null;
        } else if (action === 'mark-sent') {
          if (current.status !== 'SUBMITTED') throw new InvalidStateTransitionError();
          next.sent_reference=v.text(body.reference,'reference',300); next.sent_at=new Date().toISOString(); next.status='AWAITING_COMPANY';
        } else if (action === 'return') {
          if (!['SUBMITTED','AWAITING_COMPANY'].includes(current.status)) throw new InvalidStateTransitionError();
          next.status='NEEDS_REVISION'; next.feedback=v.text(body.reason,'reason',2000);
        } else if (action === 'confirm') {
          if (current.status !== 'AWAITING_COMPANY') throw new InvalidStateTransitionError();
          const company=v.text(body.company_name,'company_name',300), number=v.text(body.student_number,'student_number',100);
          if (v.companyNameKey(company) !== v.companyNameKey(current.submitted_payload.company_name) || number !== p.student_number) throw new ValidationError('บริษัทหรือรหัสนักศึกษาในแบบฟอร์มตอบกลับไม่ตรงกับข้อมูลที่ส่ง');
          const reference=v.text(body.reference,'reference',300,false), url=v.https(body.url);
          if (!reference && !url) throw new ValidationError('กรุณาระบุหลักฐานยืนยันจากบริษัท');
          next.status='CONFIRMED'; next.confirmed_by=actor.userId; next.confirmed_at=new Date().toISOString();
          next.evidence={company_name:company,student_number:number,reference,url};
        } else throw new ValidationError('Unknown placement command.');
        return r.savePlacement(c,p,next);
      },p.id);
    });
  }
}
module.exports = { ThreeRoleService, stable };

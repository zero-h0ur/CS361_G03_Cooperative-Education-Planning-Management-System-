const { randomUUID, createHash } = require("node:crypto");
const { getPool } = require("../../db/connection");
const { roleGuard } = require("./selection-service");
const { ValidationError, ForbiddenError, ConflictError } = require("../errors");
const v = require("./workflow-input");
const { transition } = require("./committee-workspace-domain");
const {academic}=require('./coordinator-domain');
const {handoffScope}=require('../../shared/review-access');
const academicReview=require('../../db/academic-review');
const {ServiceUnavailableError}=require('../errors');
class CommitteeWorkspaceService {
  constructor({ pool, documentStore, allowSyntheticPolicy=false } = {}) {
    this.store = documentStore;
    this.pool = pool;
    this.allowSynthetic=process.env.NODE_ENV==='test' && allowSyntheticPolicy;
  }
  db() {
    return this.pool || getPool();
  }
  async scope(db, actor, id) {
    roleGuard(actor, ["COMMITTEE"]);
    const mode=process.env.COED_API_MAINTENANCE,limited=Boolean(mode && mode!=='off'),binding=handoffScope();
    if(limited && !binding)throw new ServiceUnavailableError('ยังไม่เปิดพื้นที่กรรมการ','COED_MAINTENANCE');
    const rows = (await db.query(`SELECT c.*,r.name AS cycle_name,r.status AS cycle_status FROM selection_cohorts c JOIN rounds r ON r.id=c.cycle_id
      JOIN users u ON u.id=$1 AND u.role='COMMITTEE' AND u.account_status='ACTIVE'
      WHERE c.status='ACTIVE' AND $1 IN(c.committee_one,c.committee_two,c.committee_three)
      AND (SELECT count(*) FROM users m WHERE m.id IN(c.committee_one,c.committee_two,c.committee_three) AND m.role='COMMITTEE' AND m.account_status='ACTIVE')=3
      AND ($2::uuid IS NULL OR c.id=$2) AND ($3::uuid IS NULL OR c.cycle_id=$3) AND ($4::uuid IS NULL OR c.coordinator_id=$4)
      AND ($4::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM selection_cohorts outside WHERE outside.cycle_id=c.cycle_id AND outside.department=c.department
        AND outside.status='ACTIVE' AND outside.committee_one=c.committee_one AND outside.committee_two=c.committee_two AND outside.committee_three=c.committee_three AND outside.coordinator_id<>$4)) ORDER BY r.academic_year DESC,c.created_at,c.id`, [actor.userId, id || null,binding?.cycle_id || null,binding?.coordinator_user_id || null])).rows;
    if (id && !rows.length) throw new ForbiddenError();
    return rows;
  }
  async students(db, cohort) {
    const legacy=handoffScope()?[]:(await db.query(`SELECT p.id,s.full_name AS name,s.student_number AS number,s.program,
      sub.snapshot->'payload' AS payload, sub.snapshot->'documents' AS documents,p.version AS plan_version,a.plan_version AS received_version
      FROM selection_receipts a JOIN plans p ON p.id=a.plan_id JOIN students s ON s.id=p.student_id
      LEFT JOIN phase1_applications app ON app.student_id=s.id AND app.cycle_id=p.cycle_id AND app.status='SUBMITTED'
      LEFT JOIN LATERAL(SELECT * FROM phase1_submissions ps WHERE ps.application_id=app.id ORDER BY ps.application_version DESC LIMIT 1) sub ON true
      WHERE a.cohort_id=ANY($1::uuid[]) AND NOT p.legacy_compatibility AND p.status IN('SUBMITTED','UNDER_REVIEW') ORDER BY p.id`, [cohort.ids || [cohort.id]])).rows.map((s) => ({
      ...s,
      documents: (s.documents || []).map((d) => ({ id: d.id, filename: d.filename, kind: d.kind })),
      core: s.payload?.declared_group_gpa == null ? null : Number(s.payload.declared_group_gpa),
      gpax: s.payload?.gpax == null ? null : Number(s.payload.gpax),
      curriculum: s.payload?.curriculum || null,
      program: /พิเศษ|special/i.test(s.program) ? "special" : "regular"
    }));
    const hasReviews=await academicReview.ready(db);
    const phase1=(await db.query(`SELECT a.id,sub.snapshot,sub.application_version,sub.id AS submission_id,sub.checksum,
      ${hasReviews?'ar.assessment AS reviewed_assessment,ar.id AS academic_review_id':'NULL::jsonb AS reviewed_assessment,NULL::uuid AS academic_review_id'},sub.snapshot->'official'->>'program' AS program
      FROM phase1_reviews rv JOIN phase1_applications a ON a.id=rv.application_id
      JOIN phase1_submissions sub ON sub.id=rv.submission_id JOIN students st ON st.id=a.student_id
      ${hasReviews?`LEFT JOIN LATERAL(SELECT * FROM phase1_academic_reviews x WHERE x.submission_id=sub.id AND x.submission_checksum=sub.checksum ORDER BY version DESC LIMIT 1) ar ON true`:''}
      WHERE rv.cohort_id=ANY($1::uuid[]) AND rv.state='FORWARDED' AND a.status='SUBMITTED'
      ORDER BY a.id`,[cohort.ids || [cohort.id]])).rows.map(s=>({
        id:s.id,name:s.snapshot.official?.full_name || s.snapshot.payload?.thai_full_name || null,
        number:s.snapshot.official?.student_number || null,payload:s.snapshot.payload,
        documents:(s.snapshot.documents || []).map(d=>({id:d.id,filename:d.filename,kind:d.kind})),
        core:s.reviewed_assessment?.eligibility==='PASS'?Number(s.reviewed_assessment.group_gpa):academic(s.snapshot,{allowSynthetic:this.allowSynthetic}).core,
        gpax:s.reviewed_assessment?.eligibility==='PASS'?Number(s.reviewed_assessment.gpax):academic(s.snapshot,{allowSynthetic:this.allowSynthetic}).gpax,
        curriculum:s.reviewed_assessment?.curriculum || s.snapshot.official?.curriculum || s.snapshot.declared_academic?.curriculum || null,
        academic_review_id:s.academic_review_id,reviewed_assessment:s.reviewed_assessment,original_assessment:s.snapshot.assessment || null,submission_id:s.submission_id,checksum:s.checksum,
        program:s.reviewed_assessment?.program_type || s.snapshot.declared_academic?.program_type || (/พิเศษ|special/i.test(s.program)?'special':'regular'),
        plan_version:s.application_version,received_version:s.application_version,source:'PHASE1'
      }));
    return [...legacy,...phase1];
  }
  async read(actor, id) {
    if (id) v.uuid(id, "cohort_id");
    const db = this.db(), all = await this.scope(db, actor);
    const cohorts = all.filter((c) => !all.some((other) => other.id < c.id && other.cycle_id === c.cycle_id && other.department === c.department && other.committee_one === c.committee_one && other.committee_two === c.committee_two && other.committee_three === c.committee_three));
    if (id && !cohorts.some((c) => c.id === id)) throw new ForbiddenError();
    if (id) cohorts.sort((a, b) => a.id === id ? -1 : b.id === id ? 1 : 0);
    if (!cohorts.length) return { cohorts: [], students: [], version: 0, state: { proposal: null, history: [], selected: [], finalized: false } };
    const cohort = cohorts[0];
    cohort.ids = all.filter((c) => c.cycle_id === cohort.cycle_id && c.department === cohort.department && c.committee_one === cohort.committee_one && c.committee_two === cohort.committee_two && c.committee_three === cohort.committee_three).map((c) => c.id);
    const students = await this.students(db, cohort);
    const saved = (await db.query("SELECT version,state FROM committee_workspaces WHERE cohort_id=$1", [cohort.id])).rows[0];
    return {
      cohorts,
      cohort_id: cohort.id,
      students,
      version: saved?.version || 0,
      state: saved?.state || { proposal: null, history: [], selected: [], finalized: false },
      members: [cohort.committee_one, cohort.committee_two, cohort.committee_three],
      me: actor.userId,
      can_decide:!process.env.COED_API_MAINTENANCE || process.env.COED_API_MAINTENANCE==='off',
      cycle_name: cohort.cycle_name
    };
  }
  async download(actor, documentId) {
    v.uuid(documentId, "document_id");
    const db = this.db(), cohorts = await this.scope(db, actor);
    let doc = handoffScope()?null:(await db.query(`SELECT d.* FROM phase1_documents d JOIN phase1_applications app ON app.id=d.application_id
      JOIN phase1_submissions sub ON sub.application_id=app.id
      JOIN plans p ON p.student_id=app.student_id AND p.cycle_id=app.cycle_id
      JOIN selection_receipts receipt ON receipt.plan_id=p.id
      WHERE d.id=$1 AND receipt.cohort_id=ANY($2::uuid[]) AND NOT p.legacy_compatibility
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(sub.snapshot->'documents') x WHERE x->>'id'=d.id::text)`, [documentId, cohorts.map((c) => c.id)])).rows[0];
    if(!doc)doc=(await db.query(`SELECT d.* FROM phase1_documents d JOIN phase1_reviews rv ON rv.application_id=d.application_id
      JOIN phase1_submissions sub ON sub.id=rv.submission_id JOIN phase1_applications a ON a.id=rv.application_id
      WHERE d.id=$1 AND rv.cohort_id=ANY($2::uuid[]) AND rv.state='FORWARDED' AND a.status='SUBMITTED'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(sub.snapshot->'documents') x WHERE x->>'id'=d.id::text)`,[documentId,cohorts.map(c=>c.id)])).rows[0];
    if (!doc) throw new ForbiddenError();
    const store = this.store || require("../../storage/application-document-store").createDocumentStore();
    return { download: await store.downloadTarget({ key: doc.object_key, applicationId: doc.application_id, documentId: doc.id }) };
  }
  async mutate(actor, id, body) {
    if(process.env.COED_API_MAINTENANCE && process.env.COED_API_MAINTENANCE!=='off')throw new ServiceUnavailableError('ยังไม่เปิดการลงมติกรรมการ','COED_MAINTENANCE');
    v.uuid(id, "cohort_id");
    v.fields(body, ["operation_id", "expected_version", "action", "normal", "special", "reason", "selected", "ranking"]);
    v.command(body);
    const db = await this.db().connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["committee:" + id]);
      const [cohort] = await this.scope(db, actor, id);
      if (cohort.cycle_status !== "OPEN") throw new ConflictError("Cycle is closed.");
      const hash = createHash("sha256").update(JSON.stringify([actor.userId, id, body])).digest("hex");
      const old = (await db.query("SELECT request_hash,result FROM committee_workspace_events WHERE operation_id=$1", [body.operation_id])).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new ConflictError("Operation id reused.");
        await db.query("COMMIT");
        return old.result;
      }
      const saved = (await db.query("SELECT version,state FROM committee_workspaces WHERE cohort_id=$1 FOR UPDATE", [id])).rows[0];
      if ((saved?.version || 0) !== body.expected_version) throw new ConflictError("Workspace changed; refresh.");
      const all = await this.scope(db, actor);
      cohort.ids = all.filter((c) => c.cycle_id === cohort.cycle_id && c.department === cohort.department && c.committee_one === cohort.committee_one && c.committee_two === cohort.committee_two && c.committee_three === cohort.committee_three).map((c) => c.id);
      if (cohort.ids.some((x) => x < id)) throw new ConflictError("Use the canonical workspace.");
      const membersNow = [cohort.committee_one, cohort.committee_two, cohort.committee_three], priorProposal = saved?.state?.proposal;
      if (priorProposal && (!membersNow.includes(priorProposal.proposer) || Object.keys(priorProposal.votes).some((x) => !membersNow.includes(x)))) throw new ConflictError("Panel membership changed.");
      const students = await this.students(db, cohort);
      if (body.action === "finalize" && students.some((s) => s.plan_version !== s.received_version)) throw new ConflictError("Received application changed.");
      const members = [cohort.committee_one, cohort.committee_two, cohort.committee_three];
      const state = transition(saved?.state || { proposal: null, history: [] }, actor.userId, body, students, members), version = body.expected_version + 1;
      await db.query(`INSERT INTO committee_workspaces(cohort_id,version,state) VALUES($1,$2,$3)
        ON CONFLICT(cohort_id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state`, [id, version, JSON.stringify(state)]);
      const result = { state, version };
      await db.query(`INSERT INTO committee_workspace_events(id,operation_id,cohort_id,actor_id,request_hash,result)
        VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), body.operation_id, id, actor.userId, hash, JSON.stringify(result)]);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {
      });
      throw error;
    } finally {
      db.release();
    }
  }
}
module.exports = { CommitteeWorkspaceService, transition };

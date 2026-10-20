const { WorkflowRepository } = require('./workflow-repository');
class ThreeRoleRepository extends WorkflowRepository {
  async rows(client, sql, values = []) { return (await this.query(sql, values, client)).rows; }
  async one(client, sql, values = []) { return (await this.rows(client, sql, values))[0] || null; }
  async actor(client, id) {
    return this.one(client, 'SELECT id, role, account_status FROM users WHERE id=$1 FOR SHARE', [id]);
  }
  async plan(client, id, lock) {
    return this.one(client, `SELECT p.*, s.student_number, s.department, s.program,
      s.user_id AS student_user_id, r.academic_year, r.semester, r.end_date
      FROM plans p JOIN students s ON s.id=p.student_id JOIN rounds r ON r.id=p.cycle_id
      WHERE p.id=$1 ${lock ? 'FOR UPDATE OF p' : ''}`, [id]);
  }
  async scopes(client, actor) {
    return this.rows(client, `SELECT department, program, academic_year FROM staff_scopes
      WHERE staff_id=$1 AND status='ACTIVE' FOR SHARE`, [actor]);
  }
  async assigned(client, advisor, student) {
    return this.one(client, `SELECT id FROM advisor_assignments WHERE advisor_id=$1 AND student_id=$2
      AND status='ACTIVE' AND revoked_at IS NULL AND effective_from<=CURRENT_TIMESTAMP
      AND effective_to>CURRENT_TIMESTAMP FOR SHARE`, [advisor, student]);
  }
  async policy(client, plan) {
    return this.one(client, `SELECT id, cycle_id, department, program, version, requirements, created_at
      FROM document_policies WHERE
      ($1::uuid IS NOT NULL AND id=$1 AND cycle_id=$2) OR
      ($1::uuid IS NULL AND cycle_id=$2 AND department=$3 AND program IN ('',$4))
      ORDER BY (program <> '') DESC, version DESC LIMIT 1`,
    [plan.requirement_policy_id, plan.cycle_id, plan.department, plan.program]);
  }
  async planExtras(client, plan) {
    const submissions = await this.rows(client, `SELECT id, plan_version, policy_id, snapshot, created_at
      FROM plan_submissions WHERE plan_id=$1 ORDER BY plan_version DESC`, [plan.id]);
    const placement = await this.one(client, 'SELECT * FROM placements WHERE plan_id=$1', [plan.id]);
    const advisor = await this.one(client, `SELECT a.id, a.advisor_id, COALESCE(u.display_name,'Advisor '||left(u.id::text,8)) AS name,
      a.effective_from, a.effective_to, a.version FROM advisor_assignments a
      JOIN users u ON u.id=a.advisor_id WHERE a.student_id=$1 AND a.status='ACTIVE'
      AND a.revoked_at IS NULL AND a.effective_from<=CURRENT_TIMESTAMP
      AND a.effective_to>CURRENT_TIMESTAMP AND u.role='ADVISOR' AND u.account_status='ACTIVE'`, [plan.student_id]);
    return { submissions, placement, advisor };
  }
  async saveReferences(client, plan, body) {
    return this.one(client, `UPDATE plans SET project_title=$2, document_references=$3,
      requirement_policy_id=$4, version=version+1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 RETURNING id, version, project_title, document_references, requirement_policy_id`,
    [plan.id, body.project_title, JSON.stringify(body.references), body.policy_id]);
  }
  async latestPolicy(client, body) {
    return this.one(client, `SELECT version FROM document_policies
      WHERE cycle_id=$1 AND department=$2 AND program=$3 ORDER BY version DESC LIMIT 1`,
    [body.cycle_id, body.department, body.program]);
  }
  async publish(client, actor, body) {
    return this.one(client, `INSERT INTO document_policies
      (id,cycle_id,department,program,version,requirements,published_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,cycle_id,department,program,version,requirements`,
    [body.id, body.cycle_id, body.department, body.program, body.expected_version+1, JSON.stringify(body.requirements), actor.userId]);
  }
  async staffDashboard(client, actor, scopes) {
    const cycles = await this.rows(client, `SELECT id,name,academic_year,semester,status,end_date FROM rounds
      WHERE EXISTS (SELECT 1 FROM staff_scopes sc WHERE sc.staff_id=$1 AND sc.status='ACTIVE'
        AND (sc.academic_year IS NULL OR sc.academic_year=rounds.academic_year))
      ORDER BY academic_year DESC, semester DESC`, [actor.userId]);
    const advisors = await this.rows(client, `SELECT u.id,COALESCE(u.display_name,'Advisor '||left(u.id::text,8)) AS name,
      (SELECT count(DISTINCT a.student_id)::int FROM advisor_assignments a WHERE a.advisor_id=u.id
        AND a.status='ACTIVE' AND a.revoked_at IS NULL AND a.effective_from<=CURRENT_TIMESTAMP
        AND a.effective_to>CURRENT_TIMESTAMP) AS active_count
      FROM users u WHERE u.role='ADVISOR' AND u.account_status='ACTIVE' ORDER BY u.display_name,u.id`);
    const assignments = await this.rows(client, `SELECT a.id,a.student_id,a.advisor_id,a.plan_id,
      a.effective_from,a.effective_to,a.status,a.version,s.full_name,s.student_number,COALESCE(u.display_name,'Advisor '||left(u.id::text,8)) AS advisor_name
      FROM advisor_assignments a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=a.advisor_id
      WHERE EXISTS (SELECT 1 FROM staff_scopes sc WHERE sc.staff_id=$1 AND sc.status='ACTIVE'
        AND sc.department=s.department AND (sc.program IS NULL OR sc.program=s.program)
        AND (sc.academic_year IS NULL OR sc.academic_year=a.academic_year))
      ORDER BY a.created_at DESC LIMIT 200`, [actor.userId]);
    const policies = await this.rows(client, `SELECT d.id,d.cycle_id,d.department,d.program,d.version,d.requirements
      FROM document_policies d JOIN rounds r ON r.id=d.cycle_id WHERE EXISTS
      (SELECT 1 FROM staff_scopes sc WHERE sc.staff_id=$1 AND sc.status='ACTIVE' AND sc.department=d.department
        AND (sc.program IS NULL OR sc.program=d.program)
        AND (sc.academic_year IS NULL OR sc.academic_year=r.academic_year))
      ORDER BY d.created_at DESC LIMIT 200`, [actor.userId]);
    return { scopes, cycles, advisors, assignments, policies };
  }
  async lockAdvisors(client, ids) {
    return this.rows(client, `SELECT id,role,account_status FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids]);
  }
  async assignment(client, id, lock = false) {
    return this.one(client, `SELECT * FROM advisor_assignments WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  }
  async contact(client, actor, address, phone) {
    return this.one(client, `UPDATE students SET contact_address=$3,contact_phone=$4,
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2 RETURNING *`,
    [actor.studentId,actor.userId,address,phone]);
  }
  async createAssignment(client, actor, plan, body) {
    return this.one(client, `INSERT INTO advisor_assignments
      (id,advisor_id,student_id,academic_year,semester,effective_from,effective_to,assigned_by,plan_id)
      VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6,$7,$8)
      RETURNING id,advisor_id,student_id,plan_id,effective_from,effective_to,status,version`,
    [body.id, body.advisor_id, plan.student_id, plan.academic_year, plan.semester,
      body.effective_to, actor.userId, plan.id]);
  }
  async revoke(client, actor, assignment, reason) {
    return this.one(client, `UPDATE advisor_assignments SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,
      revoked_by=$2,revocation_reason=$3,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1
      RETURNING id,advisor_id,student_id,plan_id,status,version`, [assignment.id,actor.userId,reason]);
  }
  async savePlacement(client, plan, next) {
    return this.one(client, `INSERT INTO placements (plan_id,status,version,payload,submitted_payload,
      sent_reference,sent_at,confirmed_by,confirmed_at,evidence,feedback)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(plan_id) DO UPDATE SET status=EXCLUDED.status,version=EXCLUDED.version,
        payload=EXCLUDED.payload,submitted_payload=EXCLUDED.submitted_payload,
        sent_reference=EXCLUDED.sent_reference,sent_at=EXCLUDED.sent_at,confirmed_by=EXCLUDED.confirmed_by,
        confirmed_at=EXCLUDED.confirmed_at,evidence=EXCLUDED.evidence,feedback=EXCLUDED.feedback,
        updated_at=CURRENT_TIMESTAMP RETURNING *`, [plan.id,next.status,next.version,
      JSON.stringify(next.payload),next.submitted_payload ? JSON.stringify(next.submitted_payload) : null,
      next.sent_reference || null,next.sent_at || null,next.confirmed_by || null,next.confirmed_at || null,
      next.evidence ? JSON.stringify(next.evidence) : null,next.feedback || null]);
  }
  async receipt(client, id) { return this.one(client,'SELECT * FROM workflow_receipts WHERE operation_id=$1',[id]); }
  async record(client, actor, action, resource, body, hash, result, planId) {
    await this.query(`INSERT INTO workflow_receipts(operation_id,actor_id,action,resource_id,request_hash,result)
      VALUES($1,$2,$3,$4,$5,$6)`,[body.operation_id,actor.userId,action,resource,hash,JSON.stringify(result)],client);
    await this.query(`INSERT INTO workflow_events(id,operation_id,actor_id,action,resource_id,plan_id,detail)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [body.operation_id,actor.userId,action,resource,planId,
      JSON.stringify({ version: result.version, status: result.status, reason: body.reason || null })],client);
  }
}
module.exports = { ThreeRoleRepository };

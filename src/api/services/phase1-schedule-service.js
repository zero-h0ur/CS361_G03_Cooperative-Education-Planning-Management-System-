const { randomUUID, createHash } = require('node:crypto');
const { getPool } = require('../../db/connection');
const v = require('./workflow-input');
const {syncCoordinatorConfirmation,confirmationWindow:reconcileConfirmation}=require('./phase1-schedule-compat');
const {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError
} = require('../errors');
const {
  PHASE1_TIMEZONE,
  DEFAULT_NEAR_DEADLINE_HOURS,
  WINDOW_STATES,
  CONFIRMATION_STATUSES,
  evaluateWindow,
  formatThaiDateTime
} = require('../../shared/phase1-schedule');

function hashPayload(val) {
  return createHash('sha256').update(JSON.stringify(val)).digest('hex');
}

function parseIso(val, fieldName) {
  if (!val || typeof val !== 'string') {
    throw new ValidationError(`กรุณาระบุ ${fieldName}`);
  }
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`รูปแบบวันที่ของ ${fieldName} ไม่ถูกต้อง`);
  }
  return d.toISOString();
}

class Phase1ScheduleService {
  constructor(options = {}) {
    this.injectedPool = options.pool || null;
    this.injectedNow = options.now || null;
    this.teamsJoinUrl=null;
    try {
      const link=new URL(options.teamsJoinUrl ?? process.env.PHASE1_TEAMS_JOIN_URL);
      if(link.protocol==='https:' && link.hostname==='teams.microsoft.com' && !link.username && !link.password)this.teamsJoinUrl=link.href;
    } catch { /* Unconfigured is not a fictitious group link. */ }
  }

  get pool() {
    return this.injectedPool || getPool();
  }

  now() {
    if (typeof this.injectedNow === 'function') {
      return this.injectedNow();
    }
    if (this.injectedNow instanceof Date) {
      return this.injectedNow;
    }
    return new Date();
  }

  async verifyActiveRole(client, actor, allowedRoles) {
    if (!actor?.isAuthenticated || !actor.userId) {
      throw new UnauthorizedError();
    }
    const res = await client.query('SELECT role, account_status FROM users WHERE id = $1', [actor.userId]);
    const user = res.rows[0];
    if (!user || user.account_status !== 'ACTIVE' || user.role!==actor.role || !allowedRoles.includes(user.role)) {
      throw new ForbiddenError('ไม่มีสิทธิ์ทำรายการนี้');
    }
    return user;
  }

  async getSchedule(cycleId, actor) {
    v.uuid(cycleId,'cycle_id');
    const db = this.pool;
    if (actor) {
      await this.verifyActiveRole(db, actor, ['STUDENT', 'COORDINATOR', 'COMMITTEE', 'STAFF', 'ADMIN']);
    }

    const roundRes = await db.query(
      `SELECT r.id, r.name, r.academic_year, r.semester, r.status,
              w.opens_at, w.closes_at, w.confirmation_opens_at, w.confirmation_closes_at,
              w.announced_at, w.announced_by, w.near_deadline_hours, w.version, w.updated_at,
              s.confirmation_opens_at AS legacy_confirmation_opens_at,s.confirmation_closes_at AS legacy_confirmation_closes_at
       FROM rounds r
       LEFT JOIN phase1_cycle_windows w ON w.cycle_id = r.id
       LEFT JOIN coordinator_round_schedules s ON s.cycle_id=r.id
       WHERE r.id = $1`,
      [cycleId]
    );

    const round = roundRes.rows[0];
    if (!round) {
      throw new NotFoundError('ไม่พบรอบการรับสมัครที่ระบุ');
    }
    Object.assign(round,reconcileConfirmation(round,{confirmation_opens_at:round.legacy_confirmation_opens_at,
      confirmation_closes_at:round.legacy_confirmation_closes_at}));

    const currentNow = this.now();
    const nearHours = round.near_deadline_hours || DEFAULT_NEAR_DEADLINE_HOURS;

    let applicationWindow = evaluateWindow({
      now: currentNow,
      opensAt: round.opens_at,
      closesAt: round.closes_at,
      nearDeadlineHours: nearHours
    });
    const controlled=await require('../../db/intake-control').effective(db,cycleId,null);
    if(controlled){const state=controlled.intake;applicationWindow={state:state.is_open?'OPEN':state.reason==='UPCOMING'?'UPCOMING':'CLOSED',
      is_open:state.is_open,is_closed:!state.is_open,is_upcoming:state.reason==='UPCOMING',is_unscheduled:state.reason==='UNCONFIGURED',
      is_near_deadline:false,remaining_ms:null,opens_at:state.opens_at,closes_at:state.closes_at,intake:state};}

    const confirmationWindow = evaluateWindow({
      now: currentNow,
      opensAt: round.confirmation_opens_at,
      closesAt: round.confirmation_closes_at,
      nearDeadlineHours: nearHours
    });

    let notifications = [];
    if (actor?.userId) {
      const notifRes = await db.query(
        `SELECT id, event_type, title, message, metadata, read_at, created_at
         FROM phase1_notifications
         WHERE cycle_id = $1 AND recipient_user_id = $2
         ORDER BY created_at DESC LIMIT 20`,
        [cycleId, actor.userId]
      );
      notifications = notifRes.rows;
    }

    return {
      cycle_id: round.id,
      cycle_name: round.name,
      academic_year: round.academic_year,
      semester: round.semester,
      round_status: round.status,
      application_window: applicationWindow,
      confirmation_window: confirmationWindow,
      announced_at: round.announced_at,
      announced_by: round.announced_by,
      near_deadline_hours: nearHours,
      version: round.version || 1,
      updated_at: round.updated_at || null,
      server_time: currentNow.toISOString(),
      timezone: PHASE1_TIMEZONE,
      notifications
    };
  }

  async updateSchedule(actor, cycleId, input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.verifyActiveRole(client, actor, ['COORDINATOR']);
      await this.requireCoordinatorCycle(client,actor,cycleId);

      if (!input || typeof input !== 'object') {
        throw new ValidationError('ข้อมูลไม่ถูกต้อง');
      }

      const { operation_id, expected_version, near_deadline_hours } = input;
      v.uuid(operation_id,'operation_id');
      if (!operation_id || typeof operation_id !== 'string') {
        throw new ValidationError('กรุณาระบุ operation_id');
      }
      if (!Number.isInteger(expected_version) || expected_version < 1) {
        throw new ValidationError('expected_version ต้องเป็นจำนวนเต็มบวก');
      }

      const opensAt = parseIso(input.opens_at, 'วันเปิดรับสมัคร (opens_at)');
      const closesAt = parseIso(input.closes_at, 'วันปิดรับสมัคร (closes_at)');

      if (new Date(closesAt) <= new Date(opensAt)) {
        throw new ValidationError('วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร');
      }

      let confirmationOpensAt = null;
      let confirmationClosesAt = null;

      if (input.confirmation_opens_at || input.confirmation_closes_at) {
        if (!input.confirmation_opens_at || !input.confirmation_closes_at) {
          throw new ValidationError('กรุณาระบุทั้งวันเปิดและวันสิ้นสุดยืนยันสิทธิ์ให้ครบถ้วน');
        }
        confirmationOpensAt = parseIso(input.confirmation_opens_at, 'วันเปิดยืนยันสิทธิ์');
        confirmationClosesAt = parseIso(input.confirmation_closes_at, 'วันสิ้นสุดยืนยันสิทธิ์');

        if (new Date(confirmationClosesAt) <= new Date(confirmationOpensAt)) {
          throw new ValidationError('วันสิ้นสุดยืนยันสิทธิ์ต้องอยู่หลังวันเปิดยืนยันสิทธิ์');
        }
        if (new Date(confirmationClosesAt) <= new Date(closesAt)) {
          throw new ValidationError('วันสิ้นสุดยืนยันสิทธิ์ต้องอยู่หลังวันปิดรับสมัคร');
        }
      }

      const nearHours = near_deadline_hours !== undefined ? Number(near_deadline_hours) : DEFAULT_NEAR_DEADLINE_HOURS;
      if (!Number.isInteger(nearHours) || nearHours < 1 || nearHours > 720) {
        throw new ValidationError('near_deadline_hours ต้องอยู่ระหว่าง 1 ถึง 720 ชั่วโมง');
      }

      // Advisory lock for cycle schedule
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`phase1:cycle:${cycleId}`]);

      const reqHash = hashPayload({
        actorId:actor.userId,action:'schedule',
        cycleId,
        opensAt,
        closesAt,
        confirmationOpensAt,
        confirmationClosesAt,
        nearHours,
        expected_version
      });

      // Check idempotent replay
      const priorEvent = await client.query(
        `SELECT operation_id, payload FROM phase1_schedule_events
         WHERE operation_id = $1 AND cycle_id = $2`,
        [operation_id, cycleId]
      );

      if (priorEvent.rows.length > 0) {
        const prior = priorEvent.rows[0];
        if (prior.payload?.request_hash === reqHash) {
          await client.query('COMMIT');
          return { ...prior.payload.result, replayed: true };
        }
        throw new ConflictError('Operation ID นี้ถูกใช้กับการบันทึกกำหนดการอื่นแล้ว', 'IDEMPOTENCY_KEY_REUSED');
      }

      // Check current window record
      const curRes = await client.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id = $1 FOR UPDATE', [cycleId]);
      const cur = curRes.rows[0];

      let newVersion = 1;
      const currentNow = this.now();

      if (cur && cur.version !== expected_version) {
        throw new ConflictError('ข้อมูลกำหนดการเปลี่ยนแล้ว กรุณาโหลดล่าสุด','STALE_RECORD_CONFLICT');
      }
      await syncCoordinatorConfirmation(client,cycleId,{opens_at:opensAt,closes_at:closesAt,
        confirmation_opens_at:confirmationOpensAt,confirmation_closes_at:confirmationClosesAt},actor.userId);
      if (cur) {
        if (cur.version !== expected_version) {
          throw new ConflictError('ข้อมูลกำหนดการถูกเปลี่ยนแปลงโดยผู้อื่นแล้ว กรุณารีเฟรช', 'STALE_RECORD_CONFLICT');
        }
        newVersion = cur.version + 1;
        await client.query(
          `UPDATE phase1_cycle_windows
           SET opens_at = $2, closes_at = $3,
               confirmation_opens_at = $4, confirmation_closes_at = $5,
               near_deadline_hours = $6, version = $7,
               updated_at = $8, updated_by = $9
           WHERE cycle_id = $1`,
          [
            cycleId,
            opensAt,
            closesAt,
            confirmationOpensAt,
            confirmationClosesAt,
            nearHours,
            newVersion,
            currentNow,
            actor.userId
          ]
        );
      } else {
        await client.query(
          `INSERT INTO phase1_cycle_windows(
             cycle_id, opens_at, closes_at, confirmation_opens_at, confirmation_closes_at,
             near_deadline_hours, version, updated_at, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            cycleId,
            opensAt,
            closesAt,
            confirmationOpensAt,
            confirmationClosesAt,
            nearHours,
            1,
            currentNow,
            actor.userId
          ]
        );
      }

      const scheduleResult = {
        cycle_id: cycleId,
        opens_at: opensAt,
        closes_at: closesAt,
        confirmation_opens_at: confirmationOpensAt,
        confirmation_closes_at: confirmationClosesAt,
        near_deadline_hours: nearHours,
        version: newVersion,
        updated_at: currentNow.toISOString()
      };

      // Record audit event
      await client.query(
        `INSERT INTO phase1_schedule_events(
           id, cycle_id, event_type, actor_id, actor_role, operation_id, payload
         ) VALUES ($1, $2, 'SCHEDULE_UPDATED', $3, 'COORDINATOR', $4, $5)`,
        [
          randomUUID(),
          cycleId,
          actor.userId,
          operation_id,
          JSON.stringify({
            request_hash: reqHash,
            result: scheduleResult
          })
        ]
      );

      await client.query('COMMIT');
      return { ...scheduleResult, replayed: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async announceResults(actor, cycleId, input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.verifyActiveRole(client, actor, ['COORDINATOR']);
      await this.requireCoordinatorCycle(client,actor,cycleId);

      if (!input || typeof input !== 'object') {
        throw new ValidationError('ข้อมูลไม่ถูกต้อง');
      }

      const { operation_id, expected_version } = input;
      v.uuid(operation_id,'operation_id');
      if (!operation_id || typeof operation_id !== 'string') {
        throw new ValidationError('กรุณาระบุ operation_id');
      }
      if (!Number.isInteger(expected_version) || expected_version < 1) {
        throw new ValidationError('expected_version ต้องเป็นจำนวนเต็มบวก');
      }

      const confirmationOpensAt = parseIso(input.confirmation_opens_at, 'วันเปิดยืนยันสิทธิ์');
      const confirmationClosesAt = parseIso(input.confirmation_closes_at, 'วันสิ้นสุดยืนยันสิทธิ์');
      const currentNow = this.now();

      if (new Date(confirmationClosesAt) <= new Date(confirmationOpensAt)) {
        throw new ValidationError('วันสิ้นสุดยืนยันสิทธิ์ต้องอยู่หลังวันเปิดยืนยันสิทธิ์');
      }
      if (new Date(confirmationClosesAt) <= currentNow) {
        throw new ValidationError('วันสิ้นสุดยืนยันสิทธิ์ต้องอยู่ในอนาคต');
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`phase1:cycle:${cycleId}`]);

      const curRes = await client.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id = $1 FOR UPDATE', [cycleId]);
      const cur = curRes.rows[0];
      if (!cur) {
        throw new ValidationError('กรุณากำหนดช่วงเวลารับสมัครก่อนประกาศผล');
      }
      if (new Date(confirmationClosesAt) <= new Date(cur.closes_at)) {
        throw new ValidationError('วันสิ้นสุดยืนยันสิทธิ์ต้องอยู่หลังวันปิดรับสมัคร');
      }

      const reqHash = hashPayload({
        actorId:actor.userId,action:'announce',
        cycleId,
        confirmationOpensAt,
        confirmationClosesAt,
        expected_version
      });

      const priorEvent = await client.query(
        `SELECT operation_id, payload FROM phase1_schedule_events
         WHERE operation_id = $1 AND cycle_id = $2`,
        [operation_id, cycleId]
      );
      if (priorEvent.rows.length > 0) {
        const prior = priorEvent.rows[0];
        if (prior.payload?.request_hash === reqHash) {
          await client.query('COMMIT');
          return { ...prior.payload.result, replayed: true };
        }
        throw new ConflictError('Operation ID นี้ถูกใช้กับการประกาศผลอื่นแล้ว', 'IDEMPOTENCY_KEY_REUSED');
      }

      if(cur.version!==expected_version)throw new ConflictError('กำหนดการเปลี่ยนแล้ว กรุณาโหลดล่าสุด','STALE_RECORD_CONFLICT');
      await syncCoordinatorConfirmation(client,cycleId,{opens_at:cur.opens_at,closes_at:cur.closes_at,
        confirmation_opens_at:confirmationOpensAt,confirmation_closes_at:confirmationClosesAt},actor.userId);
      const newVersion = cur.version + 1;
      await client.query(
        `UPDATE phase1_cycle_windows
         SET announced_at = $2, announced_by = $3,
             confirmation_opens_at = $4, confirmation_closes_at = $5,
             version = $6, updated_at = $2, updated_by = $3
         WHERE cycle_id = $1`,
        [
          cycleId,
          currentNow,
          actor.userId,
          confirmationOpensAt,
          confirmationClosesAt,
          newVersion
        ]
      );

      // Update all phase1_selection_results for this cycle
      await client.query(
        `UPDATE phase1_selection_results
         SET announced_at = $2, updated_at = $2
         WHERE cycle_id = $1 AND announced_at IS NULL`,
        [cycleId, currentNow]
      );

      // Create in-app notifications for selected students
      const selectedStudents = await client.query(
        `SELECT r.student_id, s.user_id, s.full_name
         FROM phase1_selection_results r
         JOIN students s ON s.id = r.student_id
         WHERE r.cycle_id = $1 AND r.outcome = 'SELECTED'`,
        [cycleId]
      );

      const deadlineText = formatThaiDateTime(confirmationClosesAt);
      for (const row of selectedStudents.rows) {
        const dedupeKey = `notif:selection_announced:${cycleId}:${row.student_id}`;
        await client.query(
          `INSERT INTO phase1_notifications(
             id, cycle_id, recipient_user_id, recipient_role, event_type, dedupe_key, title, message, metadata
           ) VALUES ($1, $2, $3, 'STUDENT', 'SELECTION_ANNOUNCED', $4, $5, $6, $7)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            cycleId,
            row.user_id,
            dedupeKey,
            'ประกาศผลการคัดเลือกสหกิจศึกษา',
            `ยินดีด้วย! คุณได้รับคัดเลือกเข้าแผนสหกิจศึกษา กรุณายืนยันสิทธิ์ภายใน ${deadlineText}`,
            JSON.stringify({ cycle_id: cycleId, confirmation_closes_at: confirmationClosesAt })
          ]
        );
      }

      const result = {
        cycle_id: cycleId,
        announced_at: currentNow.toISOString(),
        confirmation_opens_at: confirmationOpensAt,
        confirmation_closes_at: confirmationClosesAt,
        selected_count: selectedStudents.rows.length,
        version: newVersion
      };

      await client.query(
        `INSERT INTO phase1_schedule_events(
           id, cycle_id, event_type, actor_id, actor_role, operation_id, payload
         ) VALUES ($1, $2, 'RESULTS_ANNOUNCED', $3, 'COORDINATOR', $4, $5)`,
        [
          randomUUID(),
          cycleId,
          actor.userId,
          operation_id,
          JSON.stringify({ request_hash: reqHash, result })
        ]
      );

      await client.query('COMMIT');
      return { ...result, replayed: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getStudentDecision(actor, cycleId) {
    v.uuid(cycleId,'cycle_id');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.verifyActiveRole(client, actor, ['STUDENT']);

      const studentRes = await client.query('SELECT id, user_id FROM students WHERE user_id = $1', [actor.userId]);
      const student = studentRes.rows[0];
      if (!student) {
        throw new ForbiddenError('ไม่พบข้อมูลนักศึกษาของคุณ');
      }

      const winRes = await client.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id = $1 FOR SHARE', [cycleId]);
      const win = winRes.rows[0];

      const resRes = await client.query(
        `SELECT * FROM phase1_selection_results
         WHERE cycle_id = $1 AND student_id = $2
         FOR UPDATE`,
        [cycleId, student.id]
      );
      const dec = resRes.rows[0];

      if (!dec || !win || !win.announced_at) {
        await client.query('COMMIT');
        return {
          has_result: false,
          cycle_id: cycleId,
          message: 'ยังไม่มีการประกาศผลการคัดเลือกสำหรับรอบนี้'
        };
      }

      const currentNow = this.now();

      // If selected, check auto-waive boundary
      if (dec.outcome === 'SELECTED' && dec.confirmation_status === 'PENDING_CONFIRMATION') {
        const closesAtDate = win.confirmation_closes_at ? new Date(win.confirmation_closes_at) : null;
        if (closesAtDate && currentNow >= closesAtDate) {
          // Idempotent auto-waive processing
          await client.query(
            `UPDATE phase1_selection_results
             SET confirmation_status = 'AUTO_WAIVED',
                 auto_waived_at = $2,
                 updated_at = $2,
                 version = version + 1
             WHERE id = $1 AND confirmation_status = 'PENDING_CONFIRMATION'`,
            [dec.id, currentNow]
          );

          dec.confirmation_status = 'AUTO_WAIVED';
          dec.auto_waived_at = currentNow;
          dec.version += 1;

          // Record auto-waived event
          await client.query(
            `INSERT INTO phase1_schedule_events(
               id, cycle_id, event_type, actor_id, actor_role, student_id, payload
             ) VALUES ($1, $2, 'CONFIRMATION_AUTO_WAIVED', $3, 'SYSTEM', $4, $5)`,
            [
              randomUUID(),
              cycleId,
              actor.userId,
              student.id,
              JSON.stringify({ auto_waived_at: currentNow.toISOString(), reason: 'EXPIRED' })
            ]
          );

          // Add notification
          const dedupeKey = `notif:auto_waived:${cycleId}:${student.id}`;
          await client.query(
            `INSERT INTO phase1_notifications(
               id, cycle_id, recipient_user_id, recipient_role, event_type, dedupe_key, title, message, metadata
             ) VALUES ($1, $2, $3, 'STUDENT', 'CONFIRMATION_AUTO_WAIVED', $4, $5, $6, $7)
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [
              randomUUID(),
              cycleId,
              student.user_id,
              dedupeKey,
              'หมดเวลายืนยันสิทธิ์สหกิจศึกษา',
              'คุณไม่ได้ยืนยันสิทธิ์ในระยะเวลาที่กำหนด (ระบบสละสิทธิโดยอัตโนมัติ)',
              JSON.stringify({ cycle_id: cycleId, auto_waived_at: currentNow.toISOString() })
            ]
          );
        }
      }

      await client.query('COMMIT');

      const confWindow = evaluateWindow({
        now: currentNow,
        opensAt: win.confirmation_opens_at,
        closesAt: win.confirmation_closes_at,
        nearDeadlineHours: win.near_deadline_hours || DEFAULT_NEAR_DEADLINE_HOURS
      });

      return {
        has_result: true,
        cycle_id: cycleId,
        student_id: student.id,
        outcome: dec.outcome,
        confirmation_status: dec.confirmation_status,
        announced_at: dec.announced_at,
        responded_at: dec.responded_at,
        auto_waived_at: dec.auto_waived_at,
        team_joined_at: dec.team_joined_at,
        version: dec.version,
        confirmation_window: confWindow,
        teams_join_url: (dec.confirmation_status === 'CONFIRMED' || dec.confirmation_status === 'TEAM_JOINED')
          ? this.teamsJoinUrl
          : null
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async respondConfirmation(actor, cycleId, input, actionType) {
    v.uuid(cycleId,'cycle_id');
    const isConfirm = actionType === 'CONFIRM';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.verifyActiveRole(client, actor, ['STUDENT']);

      if (!input || typeof input !== 'object') {
        throw new ValidationError('ข้อมูลไม่ถูกต้อง');
      }

      const { operation_id, expected_version, reason } = input;
      v.uuid(operation_id,'operation_id');
      if (!operation_id || typeof operation_id !== 'string') {
        throw new ValidationError('กรุณาระบุ operation_id');
      }
      if (!Number.isInteger(expected_version) || expected_version < 1) {
        throw new ValidationError('expected_version ต้องเป็นจำนวนเต็มบวก');
      }

      const studentRes = await client.query('SELECT id, user_id FROM students WHERE user_id = $1', [actor.userId]);
      const student = studentRes.rows[0];
      if (!student) {
        throw new ForbiddenError('ไม่พบข้อมูลนักศึกษาของคุณ');
      }

      // Lock this student's response attempt
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`phase1:confirm:${cycleId}:${student.id}`]);

      const reqHash = hashPayload({
        cycleId,
        studentId: student.id,
        actionType,
        expected_version,
        reason: reason || null
      });

      // Check idempotent retry
      const prior = await client.query(
        `SELECT operation_id, payload FROM phase1_schedule_events
         WHERE operation_id = $1 AND cycle_id = $2`,
        [operation_id, cycleId]
      );
      if (prior.rows.length > 0) {
        if (prior.rows[0].payload?.request_hash === reqHash) {
          await client.query('COMMIT');
          return { ...prior.rows[0].payload.result, replayed: true };
        }
        throw new ConflictError('Operation ID นี้ถูกใช้กับการยืนยันสิทธิ์รายการอื่นแล้ว', 'IDEMPOTENCY_KEY_REUSED');
      }

      const winRes = await client.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id = $1 FOR SHARE', [cycleId]);
      const win = winRes.rows[0];
      if (!win || !win.announced_at) {
        throw new InvalidStateTransitionError('ยังไม่ประกาศผลการคัดเลือก');
      }

      const decRes = await client.query(
        `SELECT * FROM phase1_selection_results
         WHERE cycle_id = $1 AND student_id = $2
         FOR UPDATE`,
        [cycleId, student.id]
      );
      const dec = decRes.rows[0];
      if (!dec) {
        throw new NotFoundError('ไม่พบผลการคัดเลือกของคุณ');
      }
      if (dec.outcome !== 'SELECTED') {
        throw new InvalidStateTransitionError('คุณไม่ได้รับสิทธิ์เข้าแผนสหกิจศึกษาในรอบนี้');
      }
      if (dec.version !== expected_version) {
        throw new ConflictError('สถานะการยืนยันสิทธิ์ถูกเปลี่ยนแปลงแล้ว กรุณารีเฟรชก่อนทำรายการ', 'STALE_RECORD_CONFLICT');
      }

      const currentNow = this.now();
      const opensAt = new Date(win.confirmation_opens_at);
      const closesAt = new Date(win.confirmation_closes_at);

      if (currentNow < opensAt) {
        throw new InvalidStateTransitionError('ยังไม่ถึงช่วงเวลายืนยันสิทธิ์');
      }

      // Race condition & Exact Cutoff: [opens_at, closes_at)
      if (currentNow >= closesAt) {
        // Automatically switch to AUTO_WAIVED if still pending
        if (dec.confirmation_status === 'PENDING_CONFIRMATION') {
          await client.query(
            `UPDATE phase1_selection_results
             SET confirmation_status = 'AUTO_WAIVED',
                 auto_waived_at = $2,
                 updated_at = $2,
                 version = version + 1
             WHERE id = $1`,
            [dec.id, currentNow]
          );

          await client.query(
            `INSERT INTO phase1_schedule_events(
               id, cycle_id, event_type, actor_id, actor_role, student_id, payload
             ) VALUES ($1, $2, 'CONFIRMATION_AUTO_WAIVED', $3, 'SYSTEM', $4, $5)`,
            [
              randomUUID(),
              cycleId,
              actor.userId,
              student.id,
              JSON.stringify({ auto_waived_at: currentNow.toISOString(), reason: 'CUTOFF_EXCEEDED' })
            ]
          );
        }
        await client.query('COMMIT');
        throw new InvalidStateTransitionError('คุณไม่ได้ยืนยันสิทธิ์ในระยะเวลาที่กำหนด (ระบบสละสิทธิโดยอัตโนมัติ)','CONFIRMATION_WINDOW_EXPIRED');
      }

      if (dec.confirmation_status !== 'PENDING_CONFIRMATION') {
        throw new InvalidStateTransitionError('คุณได้ทำรายการยืนยันหรือสละสิทธิ์ไปแล้ว');
      }

      const newStatus = isConfirm ? CONFIRMATION_STATUSES.CONFIRMED : CONFIRMATION_STATUSES.WAIVED;
      const newVersion = dec.version + 1;

      await client.query(
        `UPDATE phase1_selection_results
         SET confirmation_status = $2,
             responded_at = $3,
             response_notes = $4,
             version = $5,
             updated_at = $3
         WHERE id = $1`,
        [dec.id, newStatus, currentNow, reason || null, newVersion]
      );

      const eventType = isConfirm ? 'CONFIRMATION_SUBMITTED' : 'CONFIRMATION_WAIVED';
      const resultData = {
        cycle_id: cycleId,
        student_id: student.id,
        outcome: 'SELECTED',
        confirmation_status: newStatus,
        responded_at: currentNow.toISOString(),
        version: newVersion,
        teams_join_url: isConfirm ? this.teamsJoinUrl : null
      };

      await client.query(
        `INSERT INTO phase1_schedule_events(
           id, cycle_id, event_type, actor_id, actor_role, student_id, operation_id, payload
         ) VALUES ($1, $2, $3, $4, 'STUDENT', $5, $6, $7)`,
        [
          randomUUID(),
          cycleId,
          eventType,
          actor.userId,
          student.id,
          operation_id,
          JSON.stringify({ request_hash: reqHash, result: resultData })
        ]
      );

      // Notification to Coordinator
      const coordRes = await client.query(
        `SELECT DISTINCT c.coordinator_id FROM selection_cohorts c JOIN students s
         ON s.department=c.department AND s.program=c.program
         WHERE c.cycle_id=$1 AND c.status='ACTIVE' AND s.id=$2`,
        [cycleId,student.id]
      );
      for (const coordinator of coordRes.rows) {
        const notifMsg = isConfirm
          ? `นักศึกษาได้ยืนยันสิทธิ์เข้าแผนสหกิจศึกษาแล้ว`
          : `นักศึกษาได้ขอสละสิทธิ์เข้าแผนสหกิจศึกษา`;
        await client.query(
          `INSERT INTO phase1_notifications(
             id, cycle_id, recipient_user_id, recipient_role, event_type, dedupe_key, title, message, metadata
           ) VALUES ($1, $2, $3, 'COORDINATOR', 'CONFIRMATION_RECEIVED', $4, $5, $6, $7)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            cycleId,
            coordinator.coordinator_id,
            `notif:conf_received:${cycleId}:${student.id}:${newStatus}`,
            'การยืนยันสิทธิ์นักศึกษา',
            notifMsg,
            JSON.stringify({ student_id: student.id, status: newStatus, responded_at: currentNow.toISOString() })
          ]
        );
      }

      await client.query('COMMIT');
      return { ...resultData, replayed: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async processExpiredConfirmations(actor, cycleId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (actor) {
        await this.verifyActiveRole(client, actor, ['COORDINATOR', 'ADMIN', 'SYSTEM']);
        if(actor.role==='COORDINATOR')await this.requireCoordinatorCycle(client,actor,cycleId);
      }

      const winRes = await client.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id = $1', [cycleId]);
      const win = winRes.rows[0];
      if (!win || !win.confirmation_closes_at) {
        await client.query('COMMIT');
        return { count: 0, processed: true };
      }

      const currentNow = this.now();
      const closesAt = new Date(win.confirmation_closes_at);
      if (currentNow < closesAt) {
        await client.query('COMMIT');
        return { count: 0, processed: true, message: 'ยังไม่ถึงกำหนดสิ้นสุดการยืนยันสิทธิ์' };
      }

      const expired = await client.query(
        `SELECT r.id, r.student_id, s.user_id
         FROM phase1_selection_results r
         JOIN students s ON s.id = r.student_id
         WHERE r.cycle_id = $1 AND r.outcome = 'SELECTED' AND r.confirmation_status = 'PENDING_CONFIRMATION'
         FOR UPDATE OF r`,
        [cycleId]
      );

      let updatedCount = 0;
      for (const row of expired.rows) {
        await client.query(
          `UPDATE phase1_selection_results
           SET confirmation_status = 'AUTO_WAIVED',
               auto_waived_at = $2,
               updated_at = $2,
               version = version + 1
           WHERE id = $1`,
          [row.id, currentNow]
        );

        await client.query(
          `INSERT INTO phase1_schedule_events(
             id, cycle_id, event_type, actor_id, actor_role, student_id, payload
           ) VALUES ($1, $2, 'CONFIRMATION_AUTO_WAIVED', $3, 'SYSTEM', $4, $5)`,
          [
            randomUUID(),
            cycleId,
            actor?.userId || null,
            row.student_id,
            JSON.stringify({ auto_waived_at: currentNow.toISOString(), reason: 'BATCH_SWEEP' })
          ]
        );

        const dedupeKey = `notif:auto_waived:${cycleId}:${row.student_id}`;
        await client.query(
          `INSERT INTO phase1_notifications(
             id, cycle_id, recipient_user_id, recipient_role, event_type, dedupe_key, title, message, metadata
           ) VALUES ($1, $2, $3, 'STUDENT', 'CONFIRMATION_AUTO_WAIVED', $4, $5, $6, $7)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            cycleId,
            row.user_id,
            dedupeKey,
            'หมดเวลายืนยันสิทธิ์สหกิจศึกษา',
            'คุณไม่ได้ยืนยันสิทธิ์ในระยะเวลาที่กำหนด (ระบบสละสิทธิโดยอัตโนมัติ)',
            JSON.stringify({ cycle_id: cycleId, auto_waived_at: currentNow.toISOString() })
          ]
        );

        updatedCount++;
      }

      await client.query('COMMIT');
      return { count: updatedCount, processed: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listConfirmations(actor, cycleId, filters = {}) {
    await this.verifyActiveRole(this.pool, actor, ['COORDINATOR', 'ADMIN']);
    if(actor.role==='COORDINATOR')await this.requireCoordinatorCycle(this.pool,actor,cycleId,false);

    // Run batch sweep first to ensure 100% current state
    await this.processExpiredConfirmations(actor, cycleId);

    const { status, search } = filters;
    const params = [cycleId];
    let sql = `
      SELECT r.id, r.cycle_id, r.student_id, r.outcome, r.confirmation_status,
             r.announced_at, r.responded_at, r.auto_waived_at, r.team_joined_at, r.response_notes, r.version,
             s.student_number, s.full_name, s.department, s.program, s.contact_email, s.contact_phone
      FROM phase1_selection_results r
      JOIN students s ON s.id = r.student_id
      WHERE r.cycle_id = $1 AND r.outcome = 'SELECTED'
    `;

    if (status) {
      params.push(status);
      sql += ` AND r.confirmation_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(s.student_number) LIKE $${params.length} OR LOWER(s.full_name) LIKE $${params.length})`;
    }

    sql += ' ORDER BY r.responded_at DESC NULLS LAST, s.student_number ASC';

    const res = await this.pool.query(sql, params);

    // Compute stats
    const statsRes = await this.pool.query(
      `SELECT
         count(*)::int AS total_selected,
         count(*) FILTER (WHERE confirmation_status = 'PENDING_CONFIRMATION')::int AS pending,
         count(*) FILTER (WHERE confirmation_status = 'CONFIRMED')::int AS confirmed,
         count(*) FILTER (WHERE confirmation_status = 'WAIVED')::int AS waived,
         count(*) FILTER (WHERE confirmation_status = 'AUTO_WAIVED')::int AS auto_waived,
         count(*) FILTER (WHERE confirmation_status = 'TEAM_JOINED')::int AS team_joined
       FROM phase1_selection_results
       WHERE cycle_id = $1 AND outcome = 'SELECTED'`,
      [cycleId]
    );

    const schedule = await this.getSchedule(cycleId, actor);

    return {
      cycle_id: cycleId,
      schedule,
      stats: statsRes.rows[0] || {
        total_selected: 0,
        pending: 0,
        confirmed: 0,
        waived: 0,
        auto_waived: 0,
        team_joined: 0
      },
      confirmations: res.rows
    };
  }

  async confirmTeamJoined(actor, cycleId, studentId, input = {}) {
    v.uuid(studentId,'student_id');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.verifyActiveRole(client, actor, ['COORDINATOR']);
      await this.requireCoordinatorCycle(client,actor,cycleId);

      const currentNow = this.now();
      const res = await client.query(
        `UPDATE phase1_selection_results
         SET confirmation_status = 'TEAM_JOINED',
             team_joined_at = $3,
             version = version + 1,
             updated_at = $3
         WHERE cycle_id = $1 AND student_id = $2 AND confirmation_status = 'CONFIRMED'
         RETURNING *`,
        [cycleId, studentId, currentNow]
      );

      if (res.rows.length === 0) {
        throw new InvalidStateTransitionError('นักศึกษาต้องอยู่ในสถานะยืนยันสิทธิ์แล้วจึงจะยืนยันการเข้าร่วมกลุ่มได้');
      }

      await client.query(
        `INSERT INTO phase1_schedule_events(
           id, cycle_id, event_type, actor_id, actor_role, student_id, payload
         ) VALUES ($1, $2, 'TEAM_JOINED_CONFIRMED', $3, 'COORDINATOR', $4, $5)`,
        [
          randomUUID(),
          cycleId,
          actor.userId,
          studentId,
          JSON.stringify({ team_joined_at: currentNow.toISOString() })
        ]
      );

      await client.query('COMMIT');
      return { success: true, student_id: studentId, confirmation_status: 'TEAM_JOINED', team_joined_at: currentNow.toISOString() };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listNotifications(actor, filters = {}) {
    await this.verifyActiveRole(this.pool, actor, ['STUDENT', 'COORDINATOR', 'COMMITTEE', 'STAFF']);
    const { unread_only = false, limit = 50 } = filters;
    const params = [actor.userId];
    let sql = `
      SELECT id, cycle_id, event_type, dedupe_key, title, message, metadata, read_at, created_at
      FROM phase1_notifications
      WHERE recipient_user_id = $1
    `;
    if (unread_only===true || unread_only==='true') {
      sql += ' AND read_at IS NULL';
    }
    params.push(Math.min(100, Math.max(1, Number(limit) || 50)));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const res = await this.pool.query(sql, params);
    return { notifications: res.rows };
  }

  async markNotificationRead(actor, notificationId) {
    v.uuid(notificationId,'notification_id');
    await this.verifyActiveRole(this.pool, actor, ['STUDENT', 'COORDINATOR', 'COMMITTEE', 'STAFF']);
    const currentNow = this.now();
    const res = await this.pool.query(
      `UPDATE phase1_notifications
       SET read_at = $3
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING id, read_at`,
      [notificationId, actor.userId, currentNow]
    );
    if (res.rows.length === 0) {
      throw new NotFoundError('ไม่พบการแจ้งเตือนนี้');
    }
    return { id: notificationId, read_at: currentNow.toISOString() };
  }
  async requireCoordinatorCycle(db,actor,cycleId,lock=true) {
    v.uuid(cycleId,'cycle_id');
    const rows=(await db.query(`SELECT c.coordinator_id FROM selection_cohorts c
      WHERE c.cycle_id=$1 AND c.status='ACTIVE' ORDER BY c.id ${lock?'FOR SHARE OF c':''}`,[cycleId])).rows;
    if(!rows.length || rows.some(row=>row.coordinator_id!==actor.userId))
      throw new ForbiddenError('ต้องได้รับมอบหมายทั้งรอบก่อนทำรายการ');
  }
}

module.exports = { Phase1ScheduleService };

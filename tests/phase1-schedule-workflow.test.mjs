import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Phase1ScheduleService } from '../src/api/services/phase1-schedule-service.js';
import {
  evaluateWindow,
  WINDOW_STATES,
  CONFIRMATION_STATUSES,
  PHASE1_TIMEZONE
} from '../src/shared/phase1-schedule.js';

function mockDb(initialData = {}) {
  const tables = {
    users: initialData.users || [],
    rounds: initialData.rounds || [],
    phase1_cycle_windows: initialData.windows || [],
    phase1_selection_results: initialData.selections || [],
    phase1_schedule_events: initialData.events || [],
    phase1_notifications: initialData.notifications || [],
    students: initialData.students || [],
    selection_cohorts: initialData.cohorts || []
  };

  const client = {
    query: async (sql, params = []) => {
      // Advisory locks and transactions
      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK' ||
        sql.startsWith('SELECT pg_advisory_xact_lock')
      ) {
        return { rows: [] };
      }

      // User lookup
      if (sql.includes('FROM users WHERE id = $1')) {
        const u = tables.users.find(x => x.id === params[0]);
        return { rows: u ? [u] : [] };
      }

      // Student lookup
      if (sql.includes('FROM students WHERE user_id = $1')) {
        const s = tables.students.find(x => x.user_id === params[0]);
        return { rows: s ? [s] : [] };
      }

      // Round + Window join
      if (sql.includes('FROM rounds r') && sql.includes('LEFT JOIN phase1_cycle_windows w')) {
        const r = tables.rounds.find(x => x.id === params[0]);
        if (!r) return { rows: [] };
        const w = tables.phase1_cycle_windows.find(x => x.cycle_id === params[0]);
        return {
          rows: [{
            id: r.id,
            name: r.name,
            academic_year: r.academic_year,
            semester: r.semester,
            status: r.status,
            opens_at: w?.opens_at || null,
            closes_at: w?.closes_at || null,
            confirmation_opens_at: w?.confirmation_opens_at || null,
            confirmation_closes_at: w?.confirmation_closes_at || null,
            announced_at: w?.announced_at || null,
            announced_by: w?.announced_by || null,
            near_deadline_hours: w?.near_deadline_hours || 48,
            version: w?.version || 1,
            updated_at: w?.updated_at || null
          }]
        };
      }

      // Window select
      if (sql.includes('FROM phase1_cycle_windows WHERE cycle_id = $1')) {
        const w = tables.phase1_cycle_windows.find(x => x.cycle_id === params[0]);
        return { rows: w ? [{ ...w }] : [] };
      }

      // Window update
      if (sql.startsWith('UPDATE phase1_cycle_windows')) {
        const idx = tables.phase1_cycle_windows.findIndex(x => x.cycle_id === params[0]);
        if (idx >= 0) {
          if (sql.includes('announced_at = $2')) {
            // announce
            tables.phase1_cycle_windows[idx].announced_at = params[1];
            tables.phase1_cycle_windows[idx].announced_by = params[2];
            tables.phase1_cycle_windows[idx].confirmation_opens_at = params[3];
            tables.phase1_cycle_windows[idx].confirmation_closes_at = params[4];
            tables.phase1_cycle_windows[idx].version = params[5];
          } else {
            // update schedule
            tables.phase1_cycle_windows[idx].opens_at = params[1];
            tables.phase1_cycle_windows[idx].closes_at = params[2];
            tables.phase1_cycle_windows[idx].confirmation_opens_at = params[3];
            tables.phase1_cycle_windows[idx].confirmation_closes_at = params[4];
            tables.phase1_cycle_windows[idx].near_deadline_hours = params[5];
            tables.phase1_cycle_windows[idx].version = params[6];
            tables.phase1_cycle_windows[idx].updated_at = params[7];
          }
        }
        return { rows: [] };
      }

      // Window insert
      if (sql.startsWith('INSERT INTO phase1_cycle_windows')) {
        tables.phase1_cycle_windows.push({
          cycle_id: params[0],
          opens_at: params[1],
          closes_at: params[2],
          confirmation_opens_at: params[3],
          confirmation_closes_at: params[4],
          near_deadline_hours: params[5],
          version: params[6],
          updated_at: params[7],
          updated_by: params[8]
        });
        return { rows: [] };
      }

      // Selection results select
      if (sql.includes('FROM phase1_selection_results') && sql.includes('WHERE cycle_id = $1 AND student_id = $2')) {
        const dec = tables.phase1_selection_results.find(
          x => x.cycle_id === params[0] && x.student_id === params[1]
        );
        return { rows: dec ? [{ ...dec }] : [] };
      }

      // Selection results update single
      if (sql.startsWith('UPDATE phase1_selection_results') && sql.includes('WHERE id = $1')) {
        const idx = tables.phase1_selection_results.findIndex(x => x.id === params[0]);
        if (idx >= 0) {
          if (sql.includes("confirmation_status = 'AUTO_WAIVED'")) {
            tables.phase1_selection_results[idx].confirmation_status = 'AUTO_WAIVED';
            tables.phase1_selection_results[idx].auto_waived_at = params[1];
            tables.phase1_selection_results[idx].version += 1;
          } else {
            tables.phase1_selection_results[idx].confirmation_status = params[1];
            tables.phase1_selection_results[idx].responded_at = params[2];
            tables.phase1_selection_results[idx].response_notes = params[3];
            tables.phase1_selection_results[idx].version = params[4];
          }
        }
        return { rows: [] };
      }

      // Selection results batch update for announcement
      if (sql.startsWith('UPDATE phase1_selection_results') && sql.includes('WHERE cycle_id = $1 AND announced_at IS NULL')) {
        tables.phase1_selection_results.forEach(r => {
          if (r.cycle_id === params[0]) r.announced_at = params[1];
        });
        return { rows: [] };
      }

      // Selected students query for notifications
      if (sql.includes('FROM phase1_selection_results r') && sql.includes("r.outcome = 'SELECTED'")) {
        const rows = tables.phase1_selection_results
          .filter(r => r.cycle_id === params[0] && r.outcome === 'SELECTED')
          .map(r => {
            const s = tables.students.find(x => x.id === r.student_id);
            return { student_id: r.student_id, user_id: s?.user_id, full_name: s?.full_name };
          });
        return { rows };
      }

      // Schedule events select by operation_id
      if (sql.includes('FROM phase1_schedule_events') && sql.includes('WHERE operation_id = $1')) {
        const ev = tables.phase1_schedule_events.find(x => x.operation_id === params[0]);
        return { rows: ev ? [ev] : [] };
      }

      // Schedule events insert
      if (sql.startsWith('INSERT INTO phase1_schedule_events')) {
        let eventType = params[2];
        if (sql.includes("'SCHEDULE_UPDATED'")) eventType = 'SCHEDULE_UPDATED';
        else if (sql.includes("'RESULTS_ANNOUNCED'")) eventType = 'RESULTS_ANNOUNCED';
        else if (sql.includes("'CONFIRMATION_AUTO_WAIVED'")) eventType = 'CONFIRMATION_AUTO_WAIVED';
        else if (sql.includes("'TEAM_JOINED_CONFIRMED'")) eventType = 'TEAM_JOINED_CONFIRMED';

        const opId = params.length === 7 ? params[5] : params[3];
        tables.phase1_schedule_events.push({
          id: params[0],
          cycle_id: params[1],
          event_type: eventType || 'EVENT',
          actor_id: params[3] || params[2],
          operation_id: opId || null,
          payload: typeof params[params.length - 1] === 'string' ? JSON.parse(params[params.length - 1]) : params[params.length - 1]
        });
        return { rows: [] };
      }

      // Notifications insert
      if (sql.startsWith('INSERT INTO phase1_notifications')) {
        const dedupe = params[3];
        if (!tables.phase1_notifications.some(n => n.dedupe_key === dedupe)) {
          tables.phase1_notifications.push({
            id: params[0],
            cycle_id: params[1],
            recipient_user_id: params[2],
            event_type: sql.includes('SELECTION_ANNOUNCED') ? 'SELECTION_ANNOUNCED' :
                        sql.includes('CONFIRMATION_AUTO_WAIVED') ? 'CONFIRMATION_AUTO_WAIVED' : 'CONFIRMATION_RECEIVED',
            dedupe_key: dedupe,
            title: params[4],
            message: params[5],
            metadata: JSON.parse(params[6] || '{}'),
            read_at: null,
            created_at: new Date().toISOString()
          });
        }
        return { rows: [] };
      }

      // Selection cohorts query
      if (sql.includes('FROM selection_cohorts')) {
        const c = tables.selection_cohorts.find(x => x.cycle_id === params[0] && x.status === 'ACTIVE');
        return { rows: c ? [c] : [] };
      }

      return { rows: [] };
    },
    release: () => {}
  };

  return {
    pool: {
      connect: async () => client,
      query: client.query
    },
    tables
  };
}

test('Schedule: Coordinator updates application and confirmation windows with strict validation', async () => {
  const cycleId = randomUUID();
  const coordId = randomUUID();
  const db = mockDb({
    users: [{ id: coordId, role: 'COORDINATOR', account_status: 'ACTIVE' }],
    rounds: [{ id: cycleId, name: 'สหกิจศึกษา รอบ 1/69', academic_year: 2569, semester: 1, status: 'OPEN' }],
    windows: [{
      cycle_id: cycleId,
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-15T10:00:00.000Z',
      near_deadline_hours: 48,
      version: 1
    }]
  });

  const service = new Phase1ScheduleService({ pool: db.pool, now: () => new Date('2026-06-05T00:00:00.000Z') });
  const actor = { isAuthenticated: true, userId: coordId, role: 'COORDINATOR' };

  // 1. Invalid window ordering (closes_at <= opens_at) -> 400 Validation Error
  await assert.rejects(
    service.updateSchedule(actor, cycleId, {
      operation_id: randomUUID(),
      expected_version: 1,
      opens_at: '2026-06-15T10:00:00.000Z',
      closes_at: '2026-06-01T02:00:00.000Z'
    }),
    e => e.statusCode === 400
  );

  // 2. Successful schedule update (both application window and confirmation window)
  const opId = randomUUID();
  const updated = await service.updateSchedule(actor, cycleId, {
    operation_id: opId,
    expected_version: 1,
    opens_at: '2026-06-01T02:00:00.000Z',
    closes_at: '2026-06-20T10:00:00.000Z',
    confirmation_opens_at: '2026-07-01T02:00:00.000Z',
    confirmation_closes_at: '2026-07-10T10:00:00.000Z',
    near_deadline_hours: 48
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.replayed, false);
  assert.equal(updated.closes_at, '2026-06-20T10:00:00.000Z');

  // 3. Idempotent replay with same operation_id returns replayed: true
  const replayed = await service.updateSchedule(actor, cycleId, {
    operation_id: opId,
    expected_version: 1,
    opens_at: '2026-06-01T02:00:00.000Z',
    closes_at: '2026-06-20T10:00:00.000Z',
    confirmation_opens_at: '2026-07-01T02:00:00.000Z',
    confirmation_closes_at: '2026-07-10T10:00:00.000Z',
    near_deadline_hours: 48
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.version, 2);

  // 4. Stale record conflict when expected_version is wrong
  await assert.rejects(
    service.updateSchedule(actor, cycleId, {
      operation_id: randomUUID(),
      expected_version: 1, // now is version 2
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-25T10:00:00.000Z'
    }),
    e => e.statusCode === 409
  );
});

test('Announcement & Decision: Coordinator announces results and student views them', async () => {
  const cycleId = randomUUID();
  const coordId = randomUUID();
  const studentUserId = randomUUID();
  const studentId = randomUUID();

  const db = mockDb({
    users: [
      { id: coordId, role: 'COORDINATOR', account_status: 'ACTIVE' },
      { id: studentUserId, role: 'STUDENT', account_status: 'ACTIVE' }
    ],
    students: [{ id: studentId, user_id: studentUserId, full_name: 'สมชาย ใจดี' }],
    rounds: [{ id: cycleId, name: 'สหกิจศึกษา รอบ 1/69', status: 'OPEN' }],
    windows: [{
      cycle_id: cycleId,
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-20T10:00:00.000Z',
      version: 1,
      announced_at: null
    }],
    selections: [{
      id: randomUUID(),
      cycle_id: cycleId,
      student_id: studentId,
      outcome: 'SELECTED',
      confirmation_status: 'PENDING_CONFIRMATION',
      version: 1
    }]
  });

  let simulatedClock = new Date('2026-06-25T03:00:00.000Z');
  const service = new Phase1ScheduleService({ pool: db.pool, now: () => simulatedClock });

  const coordActor = { isAuthenticated: true, userId: coordId, role: 'COORDINATOR' };
  const studentActor = { isAuthenticated: true, userId: studentUserId, role: 'STUDENT' };

  // Before announcement, student sees no decision yet
  const preDecision = await service.getStudentDecision(studentActor, cycleId);
  assert.equal(preDecision.has_result, false);

  // Coordinator announces results
  const announceRes = await service.announceResults(coordActor, cycleId, {
    operation_id: randomUUID(),
    expected_version: 1,
    confirmation_opens_at: '2026-06-25T04:00:00.000Z',
    confirmation_closes_at: '2026-07-02T10:00:00.000Z'
  });
  assert.equal(announceRes.selected_count, 1);

  // Student receives notification
  assert.equal(db.tables.phase1_notifications.length, 1);
  assert.equal(db.tables.phase1_notifications[0].event_type, 'SELECTION_ANNOUNCED');

  // Student checks decision -> Sees SELECTED and confirmation window
  simulatedClock = new Date('2026-06-25T05:00:00.000Z'); // Inside confirmation window
  const postDecision = await service.getStudentDecision(studentActor, cycleId);
  assert.equal(postDecision.has_result, true);
  assert.equal(postDecision.outcome, 'SELECTED');
  assert.equal(postDecision.confirmation_status, 'PENDING_CONFIRMATION');
  assert.equal(postDecision.confirmation_window.is_open, true);
});

test('Confirmation Boundary & Cutoff: Before opening, during window, exactly at cutoff, and auto-waive', async () => {
  const cycleId = randomUUID();
  const studentUserId = randomUUID();
  const studentId = randomUUID();
  const coordId = randomUUID();

  const opensIso = '2026-06-25T04:00:00.000Z';
  const closesIso = '2026-07-02T10:00:00.000Z';
  const opensMs = Date.parse(opensIso);
  const closesMs = Date.parse(closesIso);

  const db = mockDb({
    users: [
      { id: studentUserId, role: 'STUDENT', account_status: 'ACTIVE' },
      { id: coordId, role: 'COORDINATOR', account_status: 'ACTIVE' }
    ],
    students: [{ id: studentId, user_id: studentUserId, full_name: 'สมหญิง รักเรียน' }],
    rounds: [{ id: cycleId, name: 'รอบ 1/69', status: 'OPEN' }],
    windows: [{
      cycle_id: cycleId,
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-20T10:00:00.000Z',
      confirmation_opens_at: opensIso,
      confirmation_closes_at: closesIso,
      announced_at: '2026-06-25T03:00:00.000Z',
      version: 2
    }],
    selections: [{
      id: randomUUID(),
      cycle_id: cycleId,
      student_id: studentId,
      outcome: 'SELECTED',
      confirmation_status: 'PENDING_CONFIRMATION',
      version: 1
    }],
    cohorts: [{ cycle_id: cycleId, coordinator_id: coordId, status: 'ACTIVE' }]
  });

  let simulatedClock = new Date(opensMs - 1000); // 1s before opening
  const service = new Phase1ScheduleService({ pool: db.pool, now: () => simulatedClock });
  const studentActor = { isAuthenticated: true, userId: studentUserId, role: 'STUDENT' };

  // 1. Confirming before confirmation opens -> Rejected
  await assert.rejects(
    service.respondConfirmation(studentActor, cycleId, { operation_id: randomUUID(), expected_version: 1 }, 'CONFIRM'),
    e => e.statusCode === 422 && e.message.includes('ยังไม่ถึงช่วงเวลายืนยันสิทธิ์')
  );

  // 2. Exactly at cutoff (now === closesMs) -> "ยืนยันพร้อมกับหมดเวลา" (Race condition!)
  simulatedClock = new Date(closesMs); // EXACT CUTOFF POINT
  await assert.rejects(
    service.respondConfirmation(studentActor, cycleId, { operation_id: randomUUID(), expected_version: 1 }, 'CONFIRM'),
    e => e.statusCode === 422 && e.message.includes('สละสิทธิโดยอัตโนมัติ')
  );

  // Check database: status was transitioned to AUTO_WAIVED!
  assert.equal(db.tables.phase1_selection_results[0].confirmation_status, 'AUTO_WAIVED');

  // Verify event recorded for audit/history
  const autoWaivedEvent = db.tables.phase1_schedule_events.find(e => e.event_type === 'CONFIRMATION_AUTO_WAIVED');
  assert.ok(autoWaivedEvent);

  // 3. Reset student to PENDING_CONFIRMATION and test normal confirmation within open window
  db.tables.phase1_selection_results[0].confirmation_status = 'PENDING_CONFIRMATION';
  db.tables.phase1_selection_results[0].version = 1;
  simulatedClock = new Date(opensMs + 3600000); // 1 hour after opening

  const confirmOp = randomUUID();
  const confirmed = await service.respondConfirmation(
    studentActor,
    cycleId,
    { operation_id: confirmOp, expected_version: 1 },
    'CONFIRM'
  );

  assert.equal(confirmed.confirmation_status, 'CONFIRMED');
  assert.ok(confirmed.teams_join_url.includes('teams.microsoft.com'));
  assert.equal(db.tables.phase1_selection_results[0].confirmation_status, 'CONFIRMED');

  // 4. Idempotent replay of confirmation with same operation_id
  const replayConfirmed = await service.respondConfirmation(
    studentActor,
    cycleId,
    { operation_id: confirmOp, expected_version: 1 },
    'CONFIRM'
  );
  assert.equal(replayConfirmed.replayed, true);
  assert.equal(replayConfirmed.confirmation_status, 'CONFIRMED');
});

test('Batch Sweep & Lazy Evaluation: Overdue confirmations are automatically waived', async () => {
  const cycleId = randomUUID();
  const student1Id = randomUUID();
  const student2Id = randomUUID();
  const user1 = randomUUID();
  const user2 = randomUUID();
  const coordId = randomUUID();

  const closesIso = '2026-07-02T10:00:00.000Z';

  const db = mockDb({
    users: [
      { id: user1, role: 'STUDENT', account_status: 'ACTIVE' },
      { id: user2, role: 'STUDENT', account_status: 'ACTIVE' },
      { id: coordId, role: 'COORDINATOR', account_status: 'ACTIVE' }
    ],
    students: [
      { id: student1Id, user_id: user1, full_name: 'นักศึกษา 1' },
      { id: student2Id, user_id: user2, full_name: 'นักศึกษา 2' }
    ],
    rounds: [{ id: cycleId, name: 'รอบ 1/69', status: 'OPEN' }],
    windows: [{
      cycle_id: cycleId,
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-20T10:00:00.000Z',
      confirmation_opens_at: '2026-06-25T04:00:00.000Z',
      confirmation_closes_at: closesIso,
      announced_at: '2026-06-25T03:00:00.000Z'
    }],
    selections: [
      { id: randomUUID(), cycle_id: cycleId, student_id: student1Id, outcome: 'SELECTED', confirmation_status: 'PENDING_CONFIRMATION', version: 1 },
      { id: randomUUID(), cycle_id: cycleId, student_id: student2Id, outcome: 'SELECTED', confirmation_status: 'CONFIRMED', version: 2 }
    ]
  });

  const nowPastDeadline = new Date(Date.parse(closesIso) + 5000); // 5s past deadline
  const service = new Phase1ScheduleService({ pool: db.pool, now: () => nowPastDeadline });

  // 1. Lazy evaluation when student 1 checks decision
  const student1Actor = { isAuthenticated: true, userId: user1, role: 'STUDENT' };
  const dec1 = await service.getStudentDecision(student1Actor, cycleId);
  assert.equal(dec1.confirmation_status, 'AUTO_WAIVED');
  assert.equal(db.tables.phase1_selection_results[0].confirmation_status, 'AUTO_WAIVED');

  // Student 2 already confirmed -> Remains CONFIRMED
  assert.equal(db.tables.phase1_selection_results[1].confirmation_status, 'CONFIRMED');

  // 2. Batch sweep by Coordinator
  const coordActor = { isAuthenticated: true, userId: coordId, role: 'COORDINATOR' };
  const sweepRes = await service.processExpiredConfirmations(coordActor, cycleId);
  assert.equal(sweepRes.processed, true);
});

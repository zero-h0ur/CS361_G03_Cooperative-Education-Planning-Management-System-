import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateWindow,
  formatThaiDateTime,
  formatRemainingTime,
  WINDOW_STATES,
  CONFIRMATION_STATUSES
} from '../src/shared/phase1-schedule.js';

test('evaluateWindow: unscheduled cases return UNSCHEDULED', () => {
  assert.equal(evaluateWindow({}).state, WINDOW_STATES.UNSCHEDULED);
  assert.equal(evaluateWindow({ opensAt: '2026-06-01T00:00:00Z' }).state, WINDOW_STATES.UNSCHEDULED);
  assert.equal(evaluateWindow({ closesAt: '2026-06-30T23:59:59Z' }).state, WINDOW_STATES.UNSCHEDULED);
  assert.equal(evaluateWindow({ opensAt: 'invalid', closesAt: 'invalid' }).state, WINDOW_STATES.UNSCHEDULED);
});

test('evaluateWindow: boundary and cutoff tests (half-open interval [opens_at, closes_at))', () => {
  const opens = '2026-06-01T09:00:00.000Z';
  const closes = '2026-06-15T17:00:00.000Z';
  const opensMs = Date.parse(opens);
  const closesMs = Date.parse(closes);

  // 1. Before opening (opens_at - 1ms)
  const beforeOpening = evaluateWindow({ now: new Date(opensMs - 1), opensAt: opens, closesAt: closes });
  assert.equal(beforeOpening.state, WINDOW_STATES.UPCOMING);
  assert.equal(beforeOpening.is_open, false);
  assert.equal(beforeOpening.is_upcoming, true);
  assert.equal(beforeOpening.is_closed, false);
  assert.equal(beforeOpening.remaining_ms, 1);

  // 2. Exactly at opening (opens_at)
  const atOpening = evaluateWindow({ now: new Date(opensMs), opensAt: opens, closesAt: closes, nearDeadlineHours: 48 });
  assert.equal(atOpening.state, WINDOW_STATES.OPEN);
  assert.equal(atOpening.is_open, true);
  assert.equal(atOpening.is_near_deadline, false);
  assert.equal(atOpening.is_closed, false);

  // 3. Exactly at near-deadline threshold (closes_at - 48h)
  const thresholdMs = 48 * 3600 * 1000;
  const atNearDeadline = evaluateWindow({ now: new Date(closesMs - thresholdMs), opensAt: opens, closesAt: closes, nearDeadlineHours: 48 });
  assert.equal(atNearDeadline.state, WINDOW_STATES.NEAR_DEADLINE);
  assert.equal(atNearDeadline.is_open, true);
  assert.equal(atNearDeadline.is_near_deadline, true);

  // 4. 1ms before near-deadline threshold (closes_at - 48h - 1ms) -> should be OPEN
  const beforeNearDeadline = evaluateWindow({ now: new Date(closesMs - thresholdMs - 1), opensAt: opens, closesAt: closes, nearDeadlineHours: 48 });
  assert.equal(beforeNearDeadline.state, WINDOW_STATES.OPEN);
  assert.equal(beforeNearDeadline.is_near_deadline, false);

  // 5. 1ms before cutoff (closes_at - 1ms) -> still OPEN (NEAR_DEADLINE)
  const rightBeforeCutoff = evaluateWindow({ now: new Date(closesMs - 1), opensAt: opens, closesAt: closes, nearDeadlineHours: 48 });
  assert.equal(rightBeforeCutoff.state, WINDOW_STATES.NEAR_DEADLINE);
  assert.equal(rightBeforeCutoff.is_open, true);
  assert.equal(rightBeforeCutoff.remaining_ms, 1);

  // 6. EXACTLY AT CUTOFF (closes_at) -> CLOSED / EXPIRED!
  const exactlyAtCutoff = evaluateWindow({ now: new Date(closesMs), opensAt: opens, closesAt: closes });
  assert.equal(exactlyAtCutoff.state, WINDOW_STATES.CLOSED);
  assert.equal(exactlyAtCutoff.is_open, false);
  assert.equal(exactlyAtCutoff.is_closed, true);
  assert.equal(exactlyAtCutoff.remaining_ms, 0);

  // 7. 1ms after cutoff (closes_at + 1ms) -> CLOSED
  const afterCutoff = evaluateWindow({ now: new Date(closesMs + 1), opensAt: opens, closesAt: closes });
  assert.equal(afterCutoff.state, WINDOW_STATES.CLOSED);
  assert.equal(afterCutoff.is_open, false);
  assert.equal(afterCutoff.is_closed, true);
  assert.equal(afterCutoff.remaining_ms, 0);
});

test('formatThaiDateTime formats with Bangkok timezone (UTC+7)', () => {
  // 2026-06-01T02:00:00Z is 09:00:00 in UTC+7 (Asia/Bangkok)
  const str = formatThaiDateTime('2026-06-01T02:00:00.000Z');
  assert.ok(str.includes('09:00'));
  assert.ok(str.includes('2569')); // Buddhist Era 2026 + 543 = 2569
  assert.ok(str.includes('น.'));
});

test('formatRemainingTime formats days, hours, minutes', () => {
  assert.equal(formatRemainingTime(0), 'หมดเวลาแล้ว');
  assert.equal(formatRemainingTime(-100), 'หมดเวลาแล้ว');
  assert.equal(formatRemainingTime(86400000 + 3600000), '1 วัน 1 ชั่วโมง');
  assert.equal(formatRemainingTime(3600000 + 120000), '1 ชั่วโมง 2 นาที');
  assert.equal(formatRemainingTime(180000), '3 นาที');
});

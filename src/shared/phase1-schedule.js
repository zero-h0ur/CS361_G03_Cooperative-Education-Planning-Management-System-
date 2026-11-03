// Shared Phase 1 schedule constants, time evaluator, and deterministic formatting.
// Standard Timezone: Asia/Bangkok (UTC+07:00). Half-open interval rule: [opens_at, closes_at).

const PHASE1_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_NEAR_DEADLINE_HOURS = 48;

const SCHEDULE_WINDOW_TYPES = Object.freeze({
  APPLICATION: 'APPLICATION',
  CONFIRMATION: 'CONFIRMATION'
});

const WINDOW_STATES = Object.freeze({
  UNSCHEDULED: 'UNSCHEDULED',
  UPCOMING: 'UPCOMING',
  OPEN: 'OPEN',
  NEAR_DEADLINE: 'NEAR_DEADLINE',
  CLOSED: 'CLOSED'
});

const CONFIRMATION_STATUSES = Object.freeze({
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  WAIVED: 'WAIVED',
  AUTO_WAIVED: 'AUTO_WAIVED',
  TEAM_JOINED: 'TEAM_JOINED'
});

const CONFIRMATION_STATUS_LABELS = Object.freeze({
  PENDING_CONFIRMATION: 'รอยืนยันสิทธิ์',
  CONFIRMED: 'ยืนยันสิทธิ์แล้ว',
  WAIVED: 'สละสิทธิ์แล้ว',
  AUTO_WAIVED: 'สละสิทธิ์โดยอัตโนมัติ',
  TEAM_JOINED: 'ยืนยันสิทธิ์เข้าแผนสหกิจเรียบร้อยแล้ว'
});

/**
 * Evaluates whether current timestamp falls before, within, or after a schedule window.
 * Rule: Half-open interval [opens_at, closes_at).
 * An exact match with closes_at is considered CLOSED/EXPIRED.
 */
function evaluateWindow({ now = new Date(), opensAt, closesAt, nearDeadlineHours = DEFAULT_NEAR_DEADLINE_HOURS } = {}) {
  if (!opensAt || !closesAt) {
    return {
      state: WINDOW_STATES.UNSCHEDULED,
      is_open: false,
      is_near_deadline: false,
      is_closed: false,
      is_upcoming: false,
      is_unscheduled: true,
      remaining_ms: null,
      opens_at: opensAt || null,
      closes_at: closesAt || null
    };
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const opensDate = opensAt instanceof Date ? opensAt : new Date(opensAt);
  const closesDate = closesAt instanceof Date ? closesAt : new Date(closesAt);

  const nowMs = nowDate.getTime();
  const opensMs = opensDate.getTime();
  const closesMs = closesDate.getTime();

  if (Number.isNaN(nowMs) || Number.isNaN(opensMs) || Number.isNaN(closesMs)) {
    return {
      state: WINDOW_STATES.UNSCHEDULED,
      is_open: false,
      is_near_deadline: false,
      is_closed: false,
      is_upcoming: false,
      is_unscheduled: true,
      remaining_ms: null,
      opens_at: opensAt,
      closes_at: closesAt
    };
  }

  // Before window opening
  if (nowMs < opensMs) {
    return {
      state: WINDOW_STATES.UPCOMING,
      is_open: false,
      is_near_deadline: false,
      is_closed: false,
      is_upcoming: true,
      is_unscheduled: false,
      remaining_ms: opensMs - nowMs,
      opens_at: opensDate.toISOString(),
      closes_at: closesDate.toISOString()
    };
  }

  // At or after cutoff point: [opens_at, closes_at) -> now >= closesMs is closed
  if (nowMs >= closesMs) {
    return {
      state: WINDOW_STATES.CLOSED,
      is_open: false,
      is_near_deadline: false,
      is_closed: true,
      is_upcoming: false,
      is_unscheduled: false,
      remaining_ms: 0,
      opens_at: opensDate.toISOString(),
      closes_at: closesDate.toISOString()
    };
  }

  // Inside open window [opens_at, closes_at)
  const remainingMs = closesMs - nowMs;
  const thresholdMs = Math.max(1, Number(nearDeadlineHours) || DEFAULT_NEAR_DEADLINE_HOURS) * 3600 * 1000;
  const isNearDeadline = remainingMs <= thresholdMs;

  return {
    state: isNearDeadline ? WINDOW_STATES.NEAR_DEADLINE : WINDOW_STATES.OPEN,
    is_open: true,
    is_near_deadline: isNearDeadline,
    is_closed: false,
    is_upcoming: false,
    is_unscheduled: false,
    remaining_ms: remainingMs,
    opens_at: opensDate.toISOString(),
    closes_at: closesDate.toISOString()
  };
}

/**
 * Formats an ISO date string in Thai locale with Asia/Bangkok timezone.
 */
function formatThaiDateTime(isoString, { includeSeconds = false, shortMonth = true } = {}) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '-';

  try {
    const formatter = new Intl.DateTimeFormat('th-TH', {
      timeZone: PHASE1_TIMEZONE,
      year: 'numeric',
      month: shortMonth ? 'short' : 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false
    });
    return formatter.format(d) + ' น.';
  } catch {
    return d.toISOString();
  }
}

/**
 * Formats milliseconds remaining into human-readable Thai text.
 */
function formatRemainingTime(ms) {
  if (typeof ms !== 'number' || ms <= 0) return 'หมดเวลาแล้ว';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} วัน ${hours} ชั่วโมง`;
  }
  if (hours > 0) {
    return `${hours} ชั่วโมง ${minutes} นาที`;
  }
  return `${Math.max(1, minutes)} นาที`;
}

module.exports = {
  PHASE1_TIMEZONE,
  DEFAULT_NEAR_DEADLINE_HOURS,
  SCHEDULE_WINDOW_TYPES,
  WINDOW_STATES,
  CONFIRMATION_STATUSES,
  CONFIRMATION_STATUS_LABELS,
  evaluateWindow,
  formatThaiDateTime,
  formatRemainingTime
};

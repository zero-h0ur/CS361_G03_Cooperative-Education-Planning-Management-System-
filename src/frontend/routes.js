const ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({
    hash: '#/student/profile',
    role: 'STUDENT',
    navLabel: 'ข้อมูลของฉัน',
    eyebrow: 'STUDENT PROFILE',
    title: 'ข้อมูลนักศึกษา',
    description: 'พื้นที่สำหรับตรวจสอบข้อมูลนักศึกษาที่เชื่อมกับบัญชีของคุณ',
    status: 'ส่วนอ่านและแก้ไขข้อมูลจริงจะเชื่อมต่อใน Issue #65'
  }),
  Object.freeze({
    hash: '#/student/plan',
    role: 'STUDENT',
    navLabel: 'แผนสหกิจ',
    eyebrow: 'CO-OP PLAN',
    title: 'แผนสหกิจของฉัน',
    description: 'พื้นที่สำหรับสร้าง ตรวจสอบ และติดตามสถานะแผนสหกิจของคุณ',
    status: 'การจัดการ Plan จริงจะเชื่อมต่อใน Issue #66'
  }),
  Object.freeze({
    hash: '#/staff/review',
    role: 'STAFF',
    navLabel: 'คิวตรวจแผน',
    eyebrow: 'STAFF WORKSPACE',
    title: 'คิวตรวจแผนสหกิจ',
    description: 'พื้นที่สำหรับค้นหาและตรวจแผนภายในขอบเขตที่ระบบมอบหมาย',
    status: 'คิวตรวจและ Workflow จริงจะเชื่อมต่อใน Issue #67'
  }),
  Object.freeze({
    hash: '#/advisor/students',
    role: 'ADVISOR',
    navLabel: 'นักศึกษาที่ดูแล',
    eyebrow: 'ADVISOR VIEW',
    title: 'นักศึกษาที่ได้รับมอบหมาย',
    description: 'รายชื่อนักศึกษาที่อยู่ใน Assignment ของคุณ ณ ตอนนี้ (อ่านอย่างเดียว)',
    status: 'Assigned-scope API (#68)'
  })
]);

// Detail routes carry one UUID path segment. They are not menu entries; the menu highlights
// their parent. A hash with a malformed id is not allowlisted, so it never reaches the API.
const UUID_SEGMENT = '([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})';
const DETAIL_ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({
    pattern: new RegExp(`^#/advisor/students/${UUID_SEGMENT}$`, 'i'),
    param: 'studentId',
    navHash: '#/advisor/students',
    role: 'ADVISOR',
    eyebrow: 'ADVISOR VIEW · READ-ONLY',
    title: 'ข้อมูลนักศึกษาที่ได้รับมอบหมาย',
    description: 'ข้อมูลนักศึกษาและแผนสหกิจที่คุณมีสิทธิ์อ่านตาม Assignment',
    status: 'Assigned-scope API (#68)'
  }),
  Object.freeze({
    pattern: new RegExp(`^#/advisor/plans/${UUID_SEGMENT}$`, 'i'),
    param: 'planId',
    navHash: '#/advisor/students',
    role: 'ADVISOR',
    eyebrow: 'ADVISOR VIEW · READ-ONLY',
    title: 'แผนสหกิจของนักศึกษา',
    description: 'รายละเอียดแผนสหกิจแบบอ่านอย่างเดียว',
    status: 'Assigned-scope API (#68)'
  })
]);

const DEFAULT_ROUTE_BY_ROLE = Object.freeze({
  STUDENT: '#/student/profile',
  STAFF: '#/staff/review',
  ADVISOR: '#/advisor/students'
});

const ROLE_LABELS = Object.freeze({
  STUDENT: 'นักศึกษา',
  STAFF: 'เจ้าหน้าที่',
  ADVISOR: 'อาจารย์ที่ปรึกษา'
});

export function getRoute(hash) {
  if (typeof hash !== 'string') {
    return null;
  }
  const route = ROUTE_DEFINITIONS.find((candidate) => candidate.hash === hash);
  if (route) {
    return route;
  }
  for (const definition of DETAIL_ROUTE_DEFINITIONS) {
    const match = definition.pattern.exec(hash);
    if (match) {
      const { pattern, param, ...rest } = definition;
      return Object.freeze({ ...rest, hash, params: Object.freeze({ [param]: match[1].toLowerCase() }) });
    }
  }
  return null;
}

export function getRoutesForRole(role) {
  return ROUTE_DEFINITIONS.filter((route) => route.role === role);
}

export function getDefaultRoute(role) {
  return DEFAULT_ROUTE_BY_ROLE[role] || null;
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'ไม่ทราบบทบาท';
}

export function isAllowlistedRoute(hash) {
  return Boolean(getRoute(hash));
}

export function canRoleAccessRoute(role, hash) {
  const route = getRoute(hash);
  return Boolean(route && route.role === role);
}

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
    description: 'พื้นที่อ่านข้อมูลนักศึกษาและแผนที่อยู่ใน Assignment ของคุณ',
    status: 'Assigned-scope API จริงจะเชื่อมต่อใน Issue #68'
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
  return ROUTE_DEFINITIONS.find((route) => route.hash === hash) || null;
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

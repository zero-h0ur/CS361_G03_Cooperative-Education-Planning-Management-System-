// Synthetic presentation only. Never import into production or call an AWS API.
export const SELECTION_SCENARIOS = Object.freeze({
  pending: 'รอรับเรื่อง / เริ่มให้ความเห็น',
  revision: 'ส่งกลับให้แก้ไขแล้ว 1 รายการ',
  review: 'บันทึกแล้วหนึ่งความเห็น',
  complete: 'ครบสามความเห็น รอประกาศผล (ไม่ใช่อนุมัติ)',
  empty: 'ยังไม่มีผู้สมัคร',
  loading: 'กำลังโหลด',
  forbidden: 'ถูกถอนสิทธิ์',
  expired: 'Session หมดอายุ',
  error: 'เชื่อมต่อไม่สำเร็จ'
});

function createSyntheticQueue(coordinator, scenario) {
  const baseCount = scenario === 'complete' ? 3 : scenario === 'review' ? 1 : 0;
  const firstReceived = !coordinator || scenario === 'review' || scenario === 'complete';
  const firstReturned = coordinator && scenario === 'revision';
  const own = scenario === 'complete';

  return [
    {
      plan_id: '50000000-0000-4000-8000-000000000101',
      plan_version: 1,
      student_number: '6609610011',
      full_name: 'ณัฐวดี ศิริกุล (นักศึกษาสมมติ)',
      department: 'วิทยาการคอมพิวเตอร์',
      program: 'หลักสูตรปกติ',
      major: 'วิทยาการคอมพิวเตอร์ (CS)',
      curriculum: 'หลักสูตร 66',
      curriculum_year: '66',
      program_track: 'คอมพิวเตอร์และวิทยาการสารสนเทศ (ภาคปกติ)',
      academic_year: 2569,
      institutional_email: 'nattawadee.s@dome.tu.ac.th',
      contact_email: 'nattawadee.personal@gmail.com',
      contact_phone: '081-234-5678',
      contact_address: '99 หมู่ 18 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120',
      guardian_name: 'นายสมศักดิ์ ศิริกุล',
      guardian_relationship: 'บิดา',
      guardian_phone: '089-111-2233',
      guardian_address: '99 หมู่ 18 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120',
      guardian_info: 'นายสมศักดิ์ ศิริกุล (บิดา) · โทร. 089-111-2233',
      cycle_name: 'ภาคการศึกษา 1/2569 — รอบสหกิจศึกษา',
      company_name: 'Agoda Services Co., Ltd.',
      position_title: 'Full-Stack Software Engineer Co-op',
      interested_positions: ['Web front-end developer', 'Full stack developer'],
      project_title: 'พัฒนาระบบวิเคราะห์และแสดงผลข้อมูลการจองแบบเรียลไทม์',
      plan_notes: 'ทักษะ: TypeScript, React, Node.js, PostgreSQL, Docker · สนใจสาย Backend และ Cloud Engineering',
      skills_detail: 'ภาษาโปรแกรม: TypeScript, JavaScript, Python, SQL\nFrameworks & Libraries: React, Next.js, Node.js, Express, Tailwind CSS\nเครื่องมือ & ฐานข้อมูล: PostgreSQL, Docker, Git, GitHub Actions, Figma\nทักษะเฉพาะด้าน: Responsive Web Design, RESTful API Development, CI/CD Basics',
      gpax: 3.42,
      core_gpa: 3.35,
      core_courses: {
        'คพ.100': 'A',
        'คพ.101': 'B+',
        'คพ.102': 'A',
        'คพ.111': 'B+',
        'คพ.213 / 216': 'B',
        'คพ.251': 'A',
        'คพ.261': 'B+'
      },
      prerequisite_courses: {
        mandatory: { code: 'คพ.180', grade: 'B+' },
        electives: {
          'คพ.262': 'A',
          'คพ.331': 'B+',
          'คพ.240': '-'
        }
      },
      advance_course: { code: 'คพ.301', status: 'กำลังศึกษา' },
      document_references: [
        { key: 'cv', filename: 'CV_Nattawadee_6609610011.pdf', reference: 'DOC-CV-101', summary: 'Resume 2 หน้า ระบุโปรเจกต์วิชา CS261 และทักษะภาษาโปรแกรมครบถ้วน' },
        { key: 'transcript', filename: 'Transcript_1_2568_Nattawadee.pdf', reference: 'DOC-TR-101', summary: 'ใบแจ้งผลการศึกษาถึงภาค 1/2568 GPAX 3.42 และวิชาหลัก 7 วิชาเฉลี่ย 3.35' },
        { key: 'photo', filename: 'StudentPhoto_Nattawadee.jpg', reference: 'DOC-PH-101', summary: 'รูปถ่ายชุดนักศึกษาหน้าตรง ขนาด 1.5 นิ้ว' },
        { key: 'conduct', filename: 'ConductCert_AdvisorSigned_101.pdf', reference: 'DOC-CD-101', summary: 'เอกสารรับรองความประพฤติ ลงนามรับรองโดยอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' }
      ],
      opinion_count: baseCount,
      state: firstReturned
        ? 'NEEDS_REVISION'
        : !firstReceived
          ? 'AWAITING_COORDINATOR'
          : baseCount === 3
            ? 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT'
            : 'UNDER_COMMITTEE_REVIEW',
      revision_notes: firstReturned
        ? 'รายการที่ต้องแก้ไข:\n- เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา\n\nรายละเอียดเพิ่มเติม:\nกรุณาให้อาจารย์ที่ปรึกษาเซ็นรับรองในส่วนท้ายของเอกสารหน้าที่ 2 แล้วอัปโหลดไฟล์ใหม่'
        : null,
      own_opinion: own
        ? { selected: true, comment: 'ความเห็นสมมติ ไม่ใช่ผลตัดสินจริง', submitted_at: '2026-10-31T00:00:00Z' }
        : null
    },
    {
      plan_id: '50000000-0000-4000-8000-000000000102',
      plan_version: 2,
      student_number: '6609610022',
      full_name: 'กิตติภพ วงศ์สวัสดิ์ (นักศึกษาสมมติ)',
      department: 'วิทยาการคอมพิวเตอร์',
      program: 'หลักสูตรพิเศษ',
      major: 'วิทยาการคอมพิวเตอร์ (CS)',
      curriculum: 'หลักสูตร 66',
      curriculum_year: '66',
      program_track: 'คอมพิวเตอร์ประยุกต์ (ภาคพิเศษ)',
      academic_year: 2569,
      institutional_email: 'kittipop.w@dome.tu.ac.th',
      contact_email: 'kittipop.work@gmail.com',
      contact_phone: '086-555-7890',
      contact_address: '45/12 ถ.พหลโยธิน แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      guardian_name: 'นางสุภาวดี วงศ์สวัสดิ์',
      guardian_relationship: 'มารดา',
      guardian_phone: '081-999-8877',
      guardian_address: '45/12 ถ.พหลโยธิน แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      guardian_info: 'นางสุภาวดี วงศ์สวัสดิ์ (มารดา) · โทร. 081-999-8877',
      cycle_name: 'ภาคการศึกษา 1/2569 — รอบสหกิจศึกษา',
      company_name: 'KASIKORN Business-Technology Group (KBTG)',
      position_title: 'Software Engineer / Data Engineer Co-op',
      interested_positions: ['Back-end developer', 'Data scientist / Data engineer'],
      project_title: 'ระบบตรวจสอบคุณภาพข้อมูลธุรกรรมอัตโนมัติด้วย Python และ SQL',
      plan_notes: 'ทักษะ: Python, Go, SQL, Airflow · สนใจสาย Data Engineering และ FinTech',
      skills_detail: 'ภาษาโปรแกรม: Python, Go, SQL\nFrameworks & Libraries: FastAPI, Pandas, NumPy, Apache Airflow\nเครื่องมือ & ฐานข้อมูล: PostgreSQL, Redis, Docker, Kafka, DBeaver\nทักษะเฉพาะด้าน: Data Pipeline Engineering, Automated Quality Check, Query Optimization',
      gpax: 2.95,
      core_gpa: 2.78,
      core_courses: {
        'คพ.100': 'B+',
        'คพ.101': 'B',
        'คพ.102': 'B',
        'คพ.111': 'C+',
        'คพ.213 / 216': 'B',
        'คพ.251': 'B+',
        'คพ.261': 'B'
      },
      prerequisite_courses: {
        mandatory: { code: 'คพ.180', grade: 'C+' },
        electives: {
          'คพ.262': '-',
          'คพ.331': 'B',
          'คพ.240': '-'
        }
      },
      advance_course: { code: 'คพ.301', status: 'กำลังศึกษา' },
      document_references: [
        { key: 'cv', filename: 'Resume_Kittipop_KBTG.pdf', reference: 'DOC-CV-102', summary: 'Resume ระบุประสบการณ์ทำโปรเจกต์ฐานข้อมูลและวิเคราะห์ข้อมูล' },
        { key: 'transcript', filename: 'Transcript_Kittipop.pdf', reference: 'DOC-TR-102', summary: 'ใบแจ้งผลการศึกษา GPAX 2.95 ผ่านเกณฑ์ขั้นต่ำ 2.75' },
        { key: 'photo', filename: 'Photo_Kittipop.png', reference: 'DOC-PH-102', summary: 'รูปถ่ายชุดนักศึกษาชัดเจน' },
        { key: 'conduct', filename: 'Conduct_Unsigned_Draft.pdf', reference: 'DOC-CD-102', summary: 'แนบไฟล์ฉบับร่าง ยังไม่ปรากฏลายเซ็นอาจารย์ที่ปรึกษา' }
      ],
      opinion_count: 0,
      state: coordinator ? 'NEEDS_REVISION' : 'UNDER_COMMITTEE_REVIEW',
      revision_notes:
        'รายการที่ต้องแก้ไข:\n- เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา\n\nรายละเอียดเพิ่มเติม:\nไฟล์เอกสารรับรองความประพฤติยังไม่มีลายเซ็นอาจารย์ที่ปรึกษา กรุณาแนบไฟล์ที่ลงนามครบถ้วนแล้วส่งใหม่',
      own_opinion: null
    },
    {
      plan_id: '50000000-0000-4000-8000-000000000103',
      plan_version: 1,
      student_number: '6109610033',
      full_name: 'ปวริศา ชัยมงคล (นักศึกษาสมมติ)',
      department: 'วิทยาการคอมพิวเตอร์',
      program: 'หลักสูตรพิเศษ',
      major: 'วิทยาการคอมพิวเตอร์ (CS)',
      curriculum: 'หลักสูตร 61',
      curriculum_year: '61',
      program_track: 'คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์ (ภาคพิเศษ)',
      academic_year: 2569,
      institutional_email: 'pawarisa.c@dome.tu.ac.th',
      contact_email: 'pawarisa.dev@gmail.com',
      contact_phone: '089-444-3210',
      contact_address: '128 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110',
      guardian_name: 'นายวิชัย ชัยมงคล',
      guardian_relationship: 'บิดา',
      guardian_phone: '082-333-4455',
      guardian_address: '128 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110',
      guardian_info: 'นายวิชัย ชัยมงคล (บิดา) · โทร. 082-333-4455',
      cycle_name: 'ภาคการศึกษา 1/2569 — รอบสหกิจศึกษา',
      company_name: 'SCBX Next Tech',
      position_title: 'AI / Machine Learning Engineer Co-op',
      interested_positions: ['Software engineer', 'System engineer (Network / Security)'],
      project_title: 'การประยุกต์ใช้โมเดลภาษาเพื่อช่วยสรุปเอกสารภายในองค์กร',
      plan_notes: 'ทักษะ: Python, PyTorch, FastAPI, RAG · สนใจสาย AI/ML และ NLP',
      skills_detail: 'ภาษาโปรแกรม: Python, C++, Bash, SQL\nFrameworks & Libraries: PyTorch, Hugging Face, Transformers, FastAPI\nเครื่องมือ & ระบบ: Linux, Docker, WireShark, Snort, Kubernetes, Git\nทักษะเฉพาะด้าน: Network Security, LLM Fine-tuning & RAG, System Administration',
      gpax: 3.68,
      core_gpa: 3.71,
      core_courses: {
        'คพ.101': 'A',
        'คพ.102': 'A',
        'คพ.111': 'B+',
        'คพ.213 / 216': 'B+',
        'คพ.251': 'A',
        'คพ.264': 'A'
      },
      prerequisite_courses: {
        mandatory: { code: 'คพ.384', grade: 'A' },
        electives: {
          'คพ.266': 'B+',
          'คพ.322': '-',
          'คพ.348': 'A'
        }
      },
      advance_course: { code: 'คพ.302', status: 'กำลังศึกษา' },
      document_references: [
        { key: 'cv', filename: 'CV_Pawarisa_AI.pdf', reference: 'DOC-CV-103', summary: 'CV ครบถ้วนพร้อมลิงก์ผลงาน GitHub' },
        { key: 'transcript', filename: 'Transcript_Pawarisa.pdf', reference: 'DOC-TR-103', summary: 'GPAX 3.68 ผ่านเกณฑ์ทุกวิชา' },
        { key: 'photo', filename: 'Photo_Pawarisa.jpg', reference: 'DOC-PH-103', summary: 'รูปถ่ายชุดนักศึกษาถูกต้องตามระเบียบ' },
        { key: 'conduct', filename: 'Conduct_Signed_Pawarisa.pdf', reference: 'DOC-CD-103', summary: 'อาจารย์ที่ปรึกษาลงนามรับรองเรียบร้อยแล้ว' }
      ],
      opinion_count: 1,
      state: 'UNDER_COMMITTEE_REVIEW',
      revision_notes: null,
      own_opinion: null
    }
  ];
}

export function selectionPreview(role, scenario) {
  const coordinator = role === 'COORDINATOR';
  const rows = createSyntheticQueue(coordinator, scenario);

  return {
    loadSession: async () => ({ role, canReviewPlan: false }),
    workflowClient: {
      request: async (path, options = {}) => {
        if (scenario === 'loading') return new Promise(() => {});
        if (scenario === 'forbidden') throw Object.assign(new Error('Synthetic forbidden'), { status: 403 });
        if (scenario === 'expired') throw Object.assign(new Error('Synthetic expired'), { status: 401 });
        if (scenario === 'error') throw new Error('Synthetic unavailable');

        if (options.method === 'POST') {
          const match = /^\/api\/v3\/(?:coordinator|committee)\/plans\/([^/]+)\/(acknowledge|return|opinion)$/.exec(path);
          const targetId = match ? match[1] : rows[0].plan_id;
          const action = match ? match[2] : 'acknowledge';
          const target = rows.find((r) => r.plan_id === targetId) || rows[0];

          if (coordinator && action === 'acknowledge') {
            target.state = 'UNDER_COMMITTEE_REVIEW';
            target.revision_notes = null;
            return { state: target.state, opinion_count: target.opinion_count };
          }
          if (coordinator && action === 'return') {
            const checklist = Array.isArray(options.body?.checklist) ? options.body.checklist : [];
            const reason = options.body?.reason || '';
            const prefix = checklist.length ? `รายการที่ต้องแก้ไข:\n${checklist.map((x) => `- ${x}`).join('\n')}\n\nรายละเอียดเพิ่มเติม:\n` : '';
            target.state = 'NEEDS_REVISION';
            target.plan_version += 1;
            target.revision_notes = `${prefix}${reason}`;
            return { state: 'NEEDS_REVISION', opinion_count: target.opinion_count, plan_version: target.plan_version };
          }
          if (!coordinator && action === 'opinion') {
            target.own_opinion = {
              selected: Boolean(options.body?.selected),
              comment: options.body?.comment || '',
              submitted_at: new Date().toISOString()
            };
            target.opinion_count = Math.min(3, target.opinion_count + 1);
            if (target.opinion_count === 3) {
              target.state = 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT';
            }
            return { opinion_count: target.opinion_count, state: target.state };
          }
        }

        const visibleRows =
          scenario === 'empty'
            ? []
            : coordinator
              ? rows
              : rows.filter((r) => r.state !== 'NEEDS_REVISION' && r.state !== 'AWAITING_COORDINATOR');

        return {
          cohorts: [
            { department: 'วิทยาการคอมพิวเตอร์', program: 'หลักสูตรปกติ' },
            { department: 'วิทยาการคอมพิวเตอร์', program: 'หลักสูตรพิเศษ' }
          ],
          applications: visibleRows,
          page: 1,
          pageSize: 25,
          has_more: false
        };
      }
    }
  };
}

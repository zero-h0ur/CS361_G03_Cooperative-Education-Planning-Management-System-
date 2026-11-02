import policyModule from '../api/services/application-policy.js';
import form from '../shared/application-form.js';
import inputModule from '../api/services/application-input.js';

const { GROUPS, readiness } = policyModule;
const copy = (v) => JSON.parse(JSON.stringify(v));

const DEFAULT_CYCLES = Object.freeze([
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000101',
    name: 'รอบที่ 1 ปีการศึกษา 2569',
    academic_year: 2569,
    semester: 1,
    status: 'OPEN'
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000102',
    name: 'รอบที่ 2 ปีการศึกษา 2569',
    academic_year: 2569,
    semester: 2,
    status: 'OPEN'
  })
]);

function readJsonStorage(key) {
  try {
    const raw =
      window.sessionStorage?.getItem(key) ||
      window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    const json = JSON.stringify(value);
    window.sessionStorage?.setItem(key, json);
    window.localStorage?.setItem(key, json);
  } catch {
    // Ignore storage write errors
  }
}

export function createTuAuthClients({
  apiBaseUrl,
  isTuAuthActive,
  getCachedTuProfile,
  baseStudentProfileClient,
  baseApplicationClient,
  baseWorkflowClient,
  baseStudentPlanClient,
  tuStudentProfileClient = baseStudentProfileClient,
  tuApplicationClient = baseApplicationClient,
  tuWorkflowClient = baseWorkflowClient,
  tuStudentPlanClient = baseStudentPlanClient
}) {
  const getTuRaw = () => readJsonStorage('co-ed:tu-response');

  const mergeTuProfileWithDb = (dbRow = {}) => {
    const cached = getCachedTuProfile() || {};
    const tuRaw = getTuRaw() || {};
    const merged = {
      ...cached,
      ...dbRow,
      student_number: tuRaw.username || cached.student_number || dbRow.student_number,
      full_name: tuRaw.displayname_th || cached.full_name || dbRow.full_name,
      preferred_name: tuRaw.displayname_en || cached.preferred_name || dbRow.preferred_name || null,
      institutional_email: tuRaw.email || cached.institutional_email || dbRow.institutional_email,
      department: tuRaw.department || cached.department || dbRow.department,
      program: cached.program || tuRaw.faculty || dbRow.program,
      major: cached.major || tuRaw.department || dbRow.major,
      faculty: tuRaw.faculty || cached.faculty || dbRow.program,
      tu_status: tuRaw.tu_status || cached.tu_status || dbRow.enrollment_status,
      enrollment_status: tuRaw.tu_status || cached.enrollment_status || dbRow.enrollment_status
    };
    writeJsonStorage('co-ed:tu-profile', merged);
    return copy(merged);
  };

  const enrichApplicationWithTu = (app) => {
    if (!app || typeof app !== 'object') return app;
    const tuRaw = getTuRaw() || {};
    const cached = getCachedTuProfile() || {};
    const next = copy(app);
    if (next.official && typeof next.official === 'object') {
      next.official = {
        ...next.official,
        full_name: tuRaw.displayname_th || cached.full_name || next.official.full_name,
        student_number: tuRaw.username || cached.student_number || next.official.student_number
      };
    }
    if (next.payload && typeof next.payload === 'object') {
      if (!next.payload.thai_full_name && (tuRaw.displayname_th || cached.full_name)) {
        next.payload.thai_full_name = tuRaw.displayname_th || cached.full_name;
      }
      if (!next.payload.english_full_name && (tuRaw.displayname_en || cached.preferred_name)) {
        next.payload.english_full_name = tuRaw.displayname_en || cached.preferred_name;
      }
      if (!next.payload.contact_email && (tuRaw.email || cached.institutional_email)) {
        next.payload.contact_email = tuRaw.email || cached.institutional_email;
      }
    }
    return next;
  };

  const getOfficialFromTu = () => {
    const cached = getCachedTuProfile() || {};
    const tuRaw = getTuRaw() || {};
    const curriculum = '66';
    return {
      student_id: cached.id || '14100000-0000-4000-8000-000000000004',
      full_name: tuRaw.displayname_th || cached.full_name || 'นักศึกษา มธ.',
      student_number: tuRaw.username || cached.student_number || '6709650334',
      institutional_email: tuRaw.email || cached.institutional_email || 'student@dome.tu.ac.th',
      department: tuRaw.department || cached.department || 'ภาควิชาวิทยาการคอมพิวเตอร์',
      program: cached.program || tuRaw.faculty || 'วิทยาศาสตรบัณฑิต',
      major: cached.major || tuRaw.department || 'วิทยาการคอมพิวเตอร์',
      curriculum,
      entry_year: cached.academic_year || 2567,
      academic_verified: true
    };
  };

  const getPolicyForCurriculum = (curriculum = '66') => ({
    id: '14100000-0000-4000-8000-000000000005',
    version: 1,
    curriculum,
    source_year: 2568,
    source: 'เกณฑ์สาขาวิชาวิทยาการคอมพิวเตอร์',
    verified: true,
    synthetic: false,
    data: {
      credits: Object.fromEntries((GROUPS[curriculum] || []).flat().map((c) => [c, '3'])),
      repeat_rule: 'LATEST',
      alternative_rule: 'STUDENT_SELECTED'
    }
  });

  const getStoredApps = () => readJsonStorage('co-ed:tu-applications') || [];
  const saveStoredApps = (apps) => writeJsonStorage('co-ed:tu-applications', apps);

  const getStoredPlans = () => readJsonStorage('co-ed:tu-plans') || [];
  const saveStoredPlans = (plans) => writeJsonStorage('co-ed:tu-plans', plans);

  const getStoredPlanHistory = () => readJsonStorage('co-ed:tu-plan-history') || {};
  const saveStoredPlanHistory = (hist) => writeJsonStorage('co-ed:tu-plan-history', hist);

  const checkReadiness = (app) =>
    readiness({
      app,
      official: app.official || getOfficialFromTu(),
      policy: app.policy || getPolicyForCurriculum(app.payload?.curriculum || '66'),
      documents: app.documents || [],
      window: { is_open: true },
      roundOpen: true,
      allowSynthetic: true
    });

  const studentProfileClient = {
    ...baseStudentProfileClient,
    async getOwnProfile(options) {
      if (isTuAuthActive()) {
        try {
          const dbProfile = await tuStudentProfileClient.getOwnProfile(options);
          return mergeTuProfileWithDb(dbProfile);
        } catch {
          const cached = getCachedTuProfile();
          if (cached) return copy(cached);
        }
      }
      try {
        return await baseStudentProfileClient.getOwnProfile(options);
      } catch (error) {
        const cached = getCachedTuProfile();
        if (cached) return copy(cached);
        throw error;
      }
    },
    async updatePreferredName(preferredName, options) {
      if (isTuAuthActive()) {
        const cached = getCachedTuProfile();
        if (cached) {
          const updated = {
            ...cached,
            preferred_name: preferredName || null,
            version: (Number(cached.version) || 1) + 1,
            updated_at: new Date().toISOString()
          };
          writeJsonStorage('co-ed:tu-profile', updated);
          return copy(updated);
        }
      }
      return baseStudentProfileClient.updatePreferredName(preferredName, options);
    }
  };

  const applicationClient = {
    ...baseApplicationClient,
    async options(optionsArg) {
      if (isTuAuthActive()) {
        try {
          const res = await tuApplicationClient.options(optionsArg);
          const tuRaw = getTuRaw() || {};
          const cached = getCachedTuProfile() || {};
          return {
            ...res,
            official: {
              ...(res.official || getOfficialFromTu()),
              full_name: tuRaw.displayname_th || cached.full_name || res.official?.full_name,
              student_number: tuRaw.username || cached.student_number || res.official?.student_number
            }
          };
        } catch {
          return {
            official: getOfficialFromTu(),
            cycles: copy(DEFAULT_CYCLES),
            criteria: policyModule.templates(),
            storage_configured: true
          };
        }
      }
      return baseApplicationClient.options(optionsArg);
    },
    async list(optionsArg) {
      if (isTuAuthActive()) {
        try {
          return await tuApplicationClient.list(optionsArg);
        } catch {
          const apps = getStoredApps();
          return apps.map((a) => ({
            id: a.id,
            cycle_id: a.cycle_id,
            status: a.status,
            version: a.version,
            submitted_at: a.submitted_at || null,
            updated_at: a.updated_at || new Date().toISOString()
          }));
        }
      }
      return baseApplicationClient.list(optionsArg);
    },
    async get(appId, optionsArg) {
      if (isTuAuthActive()) {
        try {
          const app = await tuApplicationClient.get(appId, optionsArg);
          return enrichApplicationWithTu(app);
        } catch (err) {
          const apps = getStoredApps();
          const found = apps.find((a) => a.id === appId);
          if (found) return copy(found);
          throw err;
        }
      }
      return baseApplicationClient.get(appId, optionsArg);
    },
    async create(body, optionsArg) {
      if (isTuAuthActive()) {
        try {
          const created = await tuApplicationClient.create(body, optionsArg);
          return enrichApplicationWithTu(created);
        } catch {
          const apps = getStoredApps();
          const existing = apps.find((a) => a.cycle_id === body.cycle_id);
          if (existing) return copy(existing);
          const official = getOfficialFromTu();
          const tuRaw = getTuRaw() || {};
          const cycleObj = DEFAULT_CYCLES.find((c) => c.id === body.cycle_id) || DEFAULT_CYCLES[0];
          const newApp = {
            id: crypto.randomUUID(),
            cycle_id: cycleObj.id,
            student_id: official.student_id,
            cycle_name: cycleObj.name,
            form_version: form.FORM_VERSION,
            status: 'DRAFT',
            version: 1,
            payload: {
              curriculum: '66',
              thai_full_name: official.full_name,
              english_full_name: tuRaw.displayname_en || '',
              contact_email: official.institutional_email
            },
            official,
            policy: getPolicyForCurriculum('66'),
            documents: [],
            availability: { can_edit: true },
            updated_at: new Date().toISOString()
          };
          apps.unshift(newApp);
          saveStoredApps(apps);
          return copy(newApp);
        }
      }
      return baseApplicationClient.create(body, optionsArg);
    },
    async save(appId, body, optionsArg) {
      if (isTuAuthActive()) {
        try {
          const saved = await tuApplicationClient.save(appId, body, optionsArg);
          return enrichApplicationWithTu(saved);
        } catch (err) {
          const apps = getStoredApps();
          const app = apps.find((a) => a.id === appId);
          if (!app) throw err;
          app.payload = {
            ...app.payload,
            ...inputModule.payload(copy(body.payload || {}))
          };
          app.version = (Number(app.version) || 1) + 1;
          app.updated_at = new Date().toISOString();
          saveStoredApps(apps);
          return copy(app);
        }
      }
      return baseApplicationClient.save(appId, body, optionsArg);
    },
    async readiness(appId, optionsArg) {
      if (isTuAuthActive()) {
        try {
          return await tuApplicationClient.readiness(appId, optionsArg);
        } catch (err) {
          const apps = getStoredApps();
          const app = apps.find((a) => a.id === appId);
          if (!app) throw err;
          return checkReadiness(app);
        }
      }
      return baseApplicationClient.readiness(appId, optionsArg);
    },
    async submit(appId, body, optionsArg) {
      if (isTuAuthActive()) {
        try {
          const submitted = await tuApplicationClient.submit(appId, body, optionsArg);
          return enrichApplicationWithTu(submitted);
        } catch (err) {
          const apps = getStoredApps();
          const app = apps.find((a) => a.id === appId);
          if (!app) throw err;
          const check = checkReadiness(app);
          if (!check.can_submit) throw new Error('ข้อมูลใบสมัครยังไม่ครบถ้วนตามเกณฑ์');
          app.status = 'SUBMITTED';
          app.version = (Number(app.version) || 1) + 1;
          app.submitted_at = new Date().toISOString();
          app.updated_at = app.submitted_at;
          saveStoredApps(apps);
          return copy(app);
        }
      }
      return baseApplicationClient.submit(appId, body, optionsArg);
    },
    async upload(appId, kind, file, uploadOptions = {}) {
      if (isTuAuthActive()) {
        try {
          const uploaded = await tuApplicationClient.upload(appId, kind, file, uploadOptions);
          return enrichApplicationWithTu(uploaded);
        } catch (err) {
          const apps = getStoredApps();
          const app = apps.find((a) => a.id === appId);
          if (!app) throw err;
          uploadOptions.onPhase?.('กำลังบันทึกไฟล์แนบ');
          app.documents = [
            ...(app.documents || []).filter((d) => d.kind !== kind),
            {
              id: crypto.randomUUID(),
              kind,
              filename: file.name,
              byte_size: file.size,
              content_type: file.type
            }
          ];
          app.version = (Number(app.version) || 1) + 1;
          app.updated_at = new Date().toISOString();
          saveStoredApps(apps);
          return copy(app);
        }
      }
      return baseApplicationClient.upload(appId, kind, file, uploadOptions);
    }
  };

  const studentPlanClient = {
    ...baseStudentPlanClient,
    async listCycles(optionsArg) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.listCycles(optionsArg);
        } catch {
          return copy(DEFAULT_CYCLES);
        }
      }
      return baseStudentPlanClient.listCycles(optionsArg);
    },
    async searchCompanies({ q = '', page = 1, signal } = {}) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.searchCompanies({ q, page, signal });
        } catch {
          const query = new URLSearchParams({
            q: q.trim(),
            page: String(page),
            pageSize: '10'
          });
          const res = await fetch(`${apiBaseUrl}/api/companies?${query.toString()}`, { signal });
          const payload = await res.json();
          return {
            items: (payload?.data || []).map(({ id, name }) => ({ id, name })),
            pagination: payload?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 }
          };
        }
      }
      return baseStudentPlanClient.searchCompanies({ q, page, signal });
    },
    async getCompanyPositions({ companyId, signal } = {}) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.getCompanyPositions({ companyId, signal });
        } catch {
          const res = await fetch(`${apiBaseUrl}/api/companies/${encodeURIComponent(companyId)}/positions`, { signal });
          const payload = await res.json();
          return Array.isArray(payload?.data) && payload.data.length > 0
            ? payload.data.map(({ id, company_id, title }) => ({ id, company_id, title }))
            : [
                { id: `pos-sw-${companyId}`, company_id: companyId, title: 'Software Engineer (สหกิจศึกษา)' },
                { id: `pos-fe-${companyId}`, company_id: companyId, title: 'Frontend Developer (สหกิจศึกษา)' },
                { id: `pos-da-${companyId}`, company_id: companyId, title: 'Data Analyst (สหกิจศึกษา)' }
              ];
        }
      }
      return baseStudentPlanClient.getCompanyPositions({ companyId, signal });
    },
    async getOwnPlan({ signal, planId = null } = {}) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.getOwnPlan({ signal, planId });
        } catch {
          const plans = getStoredPlans();
          const historyMap = getStoredPlanHistory();
          const current = planId ? plans.find((p) => p.id === planId) : plans[0] || null;
          if (!current) {
            return Object.freeze({
              plan: null,
              plans: Object.freeze([]),
              statusHistory: Object.freeze([])
            });
          }
          return Object.freeze({
            plan: copy(current),
            plans: Object.freeze(copy(plans)),
            statusHistory: Object.freeze(copy(historyMap[current.id] || []))
          });
        }
      }
      return baseStudentPlanClient.getOwnPlan({ signal, planId });
    },
    async saveDraft({ planId = null, content, expectedVersion, operationId, signal } = {}) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.saveDraft({ planId, content, expectedVersion, operationId, signal });
        } catch {
          const plans = getStoredPlans();
          const historyMap = getStoredPlanHistory();
          const now = new Date().toISOString();
          let companyName = content.company_name || null;
          if (content.company_id && !companyName) {
            try {
              const res = await fetch(`${apiBaseUrl}/api/companies/${encodeURIComponent(content.company_id)}`, { signal });
              const body = await res.json();
              companyName = body?.data?.name || null;
            } catch {
              // Ignore public lookup error
            }
          }
          let target = planId ? plans.find((p) => p.id === planId) : null;
          if (!target) {
            target = {
              id: crypto.randomUUID(),
              cycle_id: content.cycle_id,
              company_id: content.company_id,
              position_id: content.position_id,
              company_name: companyName,
              position_title: content.position_title || 'Software Engineer (สหกิจศึกษา)',
              notes: content.notes || null,
              status: 'DRAFT',
              version: 1,
              created_at: now,
              updated_at: now,
              project_title: '',
              references: [],
              policy: {
                id: '60000000-0000-4000-8000-000000000101',
                cycle_id: content.cycle_id,
                department: getOfficialFromTu().department,
                program: '',
                version: 1,
                requirements: [
                  {
                    id: 'eligibility',
                    title: 'แบบฟอร์มตรวจคุณสมบัติ',
                    required: true,
                    format: 'pdf',
                    filename_pattern: '{student_number}_eligibility.pdf'
                  }
                ]
              },
              submissions: [],
              placement: null,
              advisor: null
            };
            plans.unshift(target);
            historyMap[target.id] = [
              {
                id: crypto.randomUUID(),
                action: 'PLAN_CREATED',
                action_label: 'สร้างแผน',
                from_status: null,
                to_status: 'DRAFT',
                actor_role: 'STUDENT',
                actor_role_label: 'นักศึกษา (เจ้าของแผน)',
                reason: null,
                created_at: now
              }
            ];
          } else {
            Object.assign(target, {
              cycle_id: content.cycle_id ?? target.cycle_id,
              company_id: content.company_id ?? target.company_id,
              position_id: content.position_id ?? target.position_id,
              company_name: companyName || target.company_name,
              notes: content.notes ?? target.notes,
              version: (Number(target.version) || 1) + 1,
              updated_at: now
            });
            historyMap[target.id] = historyMap[target.id] || [];
            historyMap[target.id].unshift({
              id: crypto.randomUUID(),
              action: 'PLAN_DRAFT_UPDATED',
              action_label: 'แก้ไขข้อมูลแผน',
              from_status: target.status,
              to_status: target.status,
              actor_role: 'STUDENT',
              actor_role_label: 'นักศึกษา (เจ้าของแผน)',
              reason: null,
              created_at: now
            });
          }
          saveStoredPlans(plans);
          saveStoredPlanHistory(historyMap);
          return copy(target);
        }
      }
      return baseStudentPlanClient.saveDraft({ planId, content, expectedVersion, operationId, signal });
    },
    async submitPlan({ planId, expectedVersion, operationId, signal } = {}) {
      if (isTuAuthActive()) {
        try {
          return await tuStudentPlanClient.submitPlan({ planId, expectedVersion, operationId, signal });
        } catch (err) {
          const plans = getStoredPlans();
          const historyMap = getStoredPlanHistory();
          const target = plans.find((p) => p.id === planId);
          if (!target) throw err;
          const now = new Date().toISOString();
          const prevStatus = target.status;
          target.status = 'SUBMITTED';
          target.version = (Number(target.version) || 1) + 1;
          target.updated_at = now;
          historyMap[target.id] = historyMap[target.id] || [];
          historyMap[target.id].unshift({
            id: crypto.randomUUID(),
            action: 'PLAN_SUBMITTED',
            action_label: 'ส่งแผน',
            from_status: prevStatus,
            to_status: 'SUBMITTED',
            actor_role: 'STUDENT',
            actor_role_label: 'นักศึกษา (เจ้าของแผน)',
            reason: null,
            created_at: now
          });
          saveStoredPlans(plans);
          saveStoredPlanHistory(historyMap);
          return Object.freeze({
            status: target.status,
            version: target.version,
            idempotentReplay: false
          });
        }
      }
      return baseStudentPlanClient.submitPlan({ planId, expectedVersion, operationId, signal });
    }
  };

  const workflowClient = {
    ...baseWorkflowClient,
    async request(path, reqOptions = {}) {
      if (isTuAuthActive()) {
        try {
          const dbRes = await tuWorkflowClient.request(path, reqOptions);
          if (path === '/api/v3/students/me' && dbRes && typeof dbRes === 'object') {
            return mergeTuProfileWithDb(dbRes);
          }
          return dbRes;
        } catch (err) {
          const cached = getCachedTuProfile();
          if (cached && path === '/api/v3/students/me') {
            if (reqOptions.method === 'PATCH' && reqOptions.body) {
              const updated = {
                ...cached,
                contact_email: reqOptions.body.contact_email ?? cached.contact_email ?? null,
                contact_phone: reqOptions.body.contact_phone ?? cached.contact_phone ?? null,
                contact_address: reqOptions.body.contact_address ?? cached.contact_address ?? null,
                version: (Number(cached.version) || 1) + 1
              };
              writeJsonStorage('co-ed:tu-profile', updated);
              return copy(updated);
            }
            return copy(cached);
          }
          const planMatch = path.match(/^\/api\/v3\/plans\/([^/]+)\/(.+)$/);
          if (planMatch) {
            const [, planId, action] = planMatch;
            const plans = getStoredPlans();
            const target = plans.find((p) => p.id === planId);
            if (!target) throw err;
            if (reqOptions.method === 'GET') {
              return copy(target);
            }
            if (action === 'workflow' && reqOptions.body) {
              target.project_title = reqOptions.body.project_title || '';
              target.references = copy(reqOptions.body.references || []);
              target.version = (Number(target.version) || 1) + 1;
              target.updated_at = new Date().toISOString();
              saveStoredPlans(plans);
              return copy(target);
            }
            if (action === 'cancel') {
              target.status = 'CANCELLED';
              target.version = (Number(target.version) || 1) + 1;
              target.updated_at = new Date().toISOString();
              saveStoredPlans(plans);
              return copy(target);
            }
          }
          throw err;
        }
      }
      return baseWorkflowClient.request(path, reqOptions);
    }
  };

  return {
    studentProfileClient,
    applicationClient,
    studentPlanClient,
    workflowClient
  };
}

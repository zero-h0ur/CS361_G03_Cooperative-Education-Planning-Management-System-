import { transition } from "../../src/api/services/committee-workspace-domain.js";
const initial = { "students": [{ "id": "0", "name": "กานต์พิชชา วัฒนกุล", "number": "6609601001", "core": 3.92, "gpax": 3.1, "program": "regular", "curriculum": "61" }, { "id": "1", "name": "ธนกร ศิริวัฒน์", "number": "6609601002", "core": 3.83, "gpax": 3.78, "program": "regular", "curriculum": "61" }, { "id": "2", "name": "พิมพ์ชนก ภูมิรักษ์", "number": "6609601003", "core": 3.67, "gpax": 3.95, "program": "regular", "curriculum": "61" }, { "id": "3", "name": "ณัฐวดี กิตติพงศ์", "number": "6609601004", "core": 3.5, "gpax": 3.35, "program": "regular", "curriculum": "61" }, { "id": "4", "name": "อชิรญา นวลจันทร์", "number": "6609601005", "core": 3.5, "gpax": 3.35, "program": "regular", "curriculum": "61" }, { "id": "5", "name": "ภูริณัฐ แสงอรุณ", "number": "6609601006", "core": 3.33, "gpax": 3.9, "program": "regular", "curriculum": "61" }, { "id": "6", "name": "กิตติภพ รุ่งเรือง", "number": "6609601007", "core": 3.17, "gpax": 3.1, "program": "regular", "curriculum": "61" }, { "id": "7", "name": "ชลธิชา พัฒนกิจ", "number": "6609601008", "core": 3, "gpax": 2.94, "program": "regular", "curriculum": "61" }, { "id": "8", "name": "ณิชาภัทร วงศ์สกุล", "number": "6609601009", "core": 3.83, "gpax": 3.11, "program": "special", "curriculum": "61" }, { "id": "9", "name": "วรินทร อัครเดช", "number": "6609601010", "core": 3.67, "gpax": 3.9, "program": "special", "curriculum": "61" }, { "id": "10", "name": "ธนัชชา ทองประเสริฐ", "number": "6609601011", "core": 3.33, "gpax": 3.2, "program": "special", "curriculum": "61" }, { "id": "11", "name": "สิรภพ ธาราธรรม", "number": "6609601012", "core": 3, "gpax": 3.75, "program": "special", "curriculum": "61" }], "cohorts": [{ "id": "preview-cohort" }], "cohort_id": "preview-cohort", "version": 0, "members": ["one", "two", "three"], "me": "two", "cycle_name": "รอบ 1/2569 · ข้อมูลทดสอบ", "state": { "proposal": { "number": 1, "normal": 4, "special": 2, "proposer": "one", "votes": { "two": "pending", "three": "accepted" }, "status": "pending", "reason": "จำนวนรับสำหรับทดสอบการคัดเลือก", "created": "ข้อมูลทดสอบ" }, "history": [], "selected": [], "finalized": false } };
export function committeePreview(scenario) {
  let model = structuredClone(initial);
  for (const [i, name, core, gpax, program] of [[12, "นักศึกษาทดสอบ เพิ่ม 01", 3.98, 2.9, "regular"], [13, "นักศึกษาทดสอบ เพิ่ม 02", 3.05, 3.99, "regular"], [14, "นักศึกษาทดสอบ เพิ่ม 03", 3.9, 2.85, "special"], [15, "นักศึกษาทดสอบ เพิ่ม 04", 3.1, 3.98, "special"]]) model.students.push({ id: String(i), name, core, gpax, program, curriculum: "61", number: "TEST361" + i });
  return { request: async (path, options = {}) => {
    if (scenario === "loading") return new Promise(() => {
    });
    if (scenario === "error") throw new Error("Preview unavailable");
    if (["expired", "forbidden"].includes(scenario)) throw Object.assign(new Error("Preview denied"), { status: scenario === "expired" ? 401 : 403 });
    if (options.method === "POST") {
      model.state = transition(model.state, model.me, options.body, model.students, model.members);
      model.version++;
      return { state: model.state, version: model.version };
    }
    return scenario === "empty" ? { ...model, students: [] } : structuredClone(model);
  } };
}

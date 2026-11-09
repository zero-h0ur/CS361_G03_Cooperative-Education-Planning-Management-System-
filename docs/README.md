# Documentation index

เริ่มที่ [README หลัก](../README.md) และ [คู่มือ AI](../AGENTS.md) แล้วเลือกเอกสารตามคำถาม ไม่ต้องอ่านแผนย้อนหลังทั้งหมด

## สถานะเอกสารสี่ชั้น

| ชั้น | หมายความว่าอย่างไร | แหล่งอ่าน |
| --- | --- | --- |
| ข้อกำหนด/ขอบเขต | ต้องการให้ทำอะไร; อาจยังไม่ทำหรือยังไม่เปิดใช้ | Issue/PR และข้อกำหนดที่ระบุรุ่น/ขอบเขต |
| โค้ด | ทำงานอย่างไรใน source ที่ระบุ | [V4 architecture](architecture/G03-V4-architecture.md), source และ tests |
| Deploy | AWS เคยถูกยืนยันว่าใช้รุ่น/การตั้งค่าใด ณ เวลาใด | [Current deployment](operations/current-deployment.md) |
| ผลทดสอบ | ตรวจอะไร ผ่านอะไร จำลองส่วนใด และยังไม่ยืนยันอะไร | [Student intake verification](operations/student-intake-verification.md) |

**Merge, Build, ZIP และ CI ผ่าน ไม่เท่ากับ Deploy หรือผ่านการใช้งานจริงครบทุก role** สถานะ AWS ในเอกสารเป็น snapshot ไม่ใช่สถานะเรียลไทม์

## เอกสารหลักปัจจุบัน

| ต้องการทราบ | อ่านไฟล์ | ประเภท |
| --- | --- | --- |
| ระบบ/บทบาท/เริ่มพัฒนา | [Root README](../README.md) | ทางเข้า |
| แต่ละโฟลเดอร์เก็บอะไร/ไฟล์ทำอะไร/ควรแก้ตรงไหน | [Repository map](repository-map.md) | แผนที่ source และเอกสาร ใช้ร่วมกันทั้งคนและ AI |
| AI ต้องอ่าน/ห้ามทำอะไร/เลือก tests | [AGENTS](../AGENTS.md) | คำแนะนำทำงาน |
| TU/Cognito, API/Lambda, RDS/S3 และใบสมัครถึง Coordinator | [G03-V4-architecture](architecture/G03-V4-architecture.md) | โครงสร้างโค้ดปัจจุบัน |
| เหตุผลและ tradeoffs | [Decisions index](decisions/README.md) | บันทึกการตัดสินใจ |
| AWS รุ่นใด เปิด/ปิดอะไร | [Current deployment](operations/current-deployment.md) | หลักฐาน Deploy แบบระบุวันที่ |
| ทดสอบ intake อย่างไร/ข้อจำกัด | [Student intake verification](operations/student-intake-verification.md) | ผลทดสอบและวิธีตรวจ |
| พัฒนาในเครื่อง/ข้อมูลจำลอง | [Team Dev/Test](operations/team-dev-test.md), [UI Preview](frontend/local-ui-preview.md) | คู่มือ local; อ่านข้อจำกัด suite ใหม่ด้วย |
| Branch/PR/review | [CONTRIBUTING](../CONTRIBUTING.md) | กระบวนการทีม |
| สิทธิ์ Repo/AWS ต่างจาก role ในแอปอย่างไร | [Team access](operations/team-access.md) | คู่มือสิทธิ์; ไม่ใช่รายการอนุมัติใหม่ |

ลำดับส่งต่อให้ AI ของเพื่อน:

```text
อ่าน AGENTS.md, README.md และ docs/README.md ก่อน
อ่าน docs/repository-map.md เพื่อหาโฟลเดอร์/ไฟล์ของงาน
อ่าน V4 Architecture และ Decisions ที่เกี่ยวข้อง
อ่าน Current deployment และ Student intake verification
แยกข้อกำหนด / โค้ด / AWS / ผลทดสอบออกจากกัน
ตรวจ source และ tests ของงาน อย่าใช้ข้อเสนอเก่าเป็นคำสั่ง Deploy
```

## Contracts และคู่มือเฉพาะส่วน

- [V3 shared API](api/v3-shared-contract.md) และ [three-role workflow](api/three-role-workflow.md): โดเมนแผนเดิม ไม่ใช่ใบสมัคร Phase 1 ทั้งหมด
- [Phase 1 preparation contract](api/v4-application-preparation.md): ฐาน contract เดิม; pending-academic intake และ controls เป็นส่วนขยายใน architecture/source ปัจจุบัน
- [Coordinator workspace evidence](evidence/coordinator-workspace-redesign.md): ผล local ของช่วงนั้น ไม่ใช่การเปิด review/forward ใน pilot ปัจจุบัน
- [Academic review and handoff](api/v4-academic-review.md) และ [local verification](operations/academic-review-verification.md): ส่วนขยาย source ที่ยังไม่ Deploy; ต้องมีเกณฑ์ยืนยันครบก่อนส่ง Committee
- [Committee integration verification](operations/committee-integration-verification.md): ผลผสาน PR #172 กับ academic review ของ PR #171 ในเครื่อง พร้อมข้อจำกัด regression และ release
- [Confirmed department criteria](api/v4-confirmed-academic-criteria.md): เกณฑ์ที่เจ้าของยืนยัน 2026-11-08 — 3 หน่วยกิต, เกรดสูงสุดขั้นต่ำ C และ CS213/CS216 ตามภาค; ยังไม่ได้เผยแพร่ลง RDS
- [Partner directory operations](operations/partner-directory.md): ข้อมูลบริษัทและ privacy boundary
- [Local release candidate](operations/v4-local-release-candidate.md): การแพ็กและ release gate ไม่ใช่คำสั่ง Deploy อัตโนมัติ

## ประวัติและข้อเสนอ — ห้ามถือเป็นสถานะปัจจุบัน

เอกสารเหล่านี้คงไว้เพื่ออธิบายลำดับงาน/หลักฐาน ณ เวลานั้น ข้อความ “ยังไม่ Deploy”, “browse-only” หรือ “48 ชั่วโมง” ภายในอาจถูก supersede แล้ว ให้เริ่มจาก Current deployment เสมอ

| กลุ่ม | เอกสาร | ใช้เพื่อ |
| --- | --- | --- |
| ฐาน V4 ช่วงย้ายระบบ | [V4 baseline](operations/v4-baseline.md), [migration evidence](evidence/v4-migration-baseline.md) | ประวัติการย้ายจาก Lab ไม่ใช่รุ่น AWS ล่าสุด |
| TU รุ่นก่อน onboarding | [identity/delivery decision](architecture/tu-student-identity-and-delivery.md), [split-auth local](evidence/tu-split-auth-local.md), [main alignment](evidence/main-tu-auth-alignment.md) | เหตุผล/ผล local ของแต่ละช่วง |
| TU Deploy/ลงทะเบียน | [production evidence](evidence/tu-production-deployment.md), [registration evidence](evidence/tu-student-registration-rollout.md) | ประวัติ error และขั้นแก้ ไม่ใช่ผล Login ล่าสุด |
| Observed schema | [upgrade evidence](evidence/tu-present-schema-upgrade.md), [upgrade rollout](operations/tu-observed-upgrade-rollout.md) | ที่มา baseline/gates; ไม่ใช่ให้รัน SQL ซ้ำ |
| Intake/read-only | [browse evidence](evidence/read-only-application-browse.md), [initial intake proposal](operations/student-application-intake-rollout.md) | ก่อนเปิดสร้าง/แนบ/ส่ง; ข้อเสนอ 48 ชั่วโมงถูกแทนแล้ว |
| C7 controls | [controls rollout and Apply record](operations/coordinator-intake-controls-rollout.md) | เก็บทั้งข้อเสนอและบันทึก Apply; บางหัวข้อเป็น pre-deployment snapshot |
| V3 | [architecture](architecture/G03-V3-architecture.md), [delivery index](evidence/v3-delivery-index.md), [operating guide](operations/v3-operating-guide.md), [selection workflow](operations/selection-workflow.md) | ระบบเดิม/หลักฐานส่งมอบ; คำสั่งและ URL Lab อาจหมดอายุ |
| V2 | [backend setup](v2-backend-setup.md), [decisions](decisions/issue-30-decisions.md), [verification](issue-32-manual-verification.md) | ประวัติ Company Directory |

`docs/plans/`, `tmp/` และ operational checkpoints บางชุดเป็น local/ignored artifacts ไม่รับประกันว่าจะมีใน clone ของเพื่อน จึงไม่ใช้เป็นทางเข้าเอกสารหรือคู่มือรันงานที่จำเป็นเพียงแห่งเดียว

## ดูแลเอกสารเมื่อเปลี่ยนระบบ

เปลี่ยนโครงสร้าง → แก้ architecture; เปลี่ยนเหตุผล/กติกา → เพิ่ม decision; Deploy จริง → แก้ snapshot พร้อมรุ่น/source/หลักฐาน; ทดสอบ → ลงผลและขอบเขตใน verification เอกสารย้อนหลังไม่ต้องลบหรือแก้ผลเดิมให้เหมือนสถานะใหม่

ก่อนส่งงานรัน `npm run test:docs` และตรวจ diff ว่าไม่มี credentials, ข้อมูลนักศึกษาจริง, UUID ผูกบัญชี หรือ URL เอกสารส่วนตัว ตัวตรวจลิงก์นี้ตรวจ local link/anchor และรูปแบบ URL โดยไม่เข้าถึง AWS หรือรับประกันว่าเว็บไซต์ภายนอกยังออนไลน์

- [Coordinator review-window verification](operations/review-window-verification.md): local independent date setup, migration trial and testing limits (2026-11-10).
- [Coordinator Committee-results contract](api/v4-coordinator-results.md) และ [local verification](operations/coordinator-results-verification.md): Dashboard อ่านผลที่ยืนยันแล้ว แยกจากการตัดสิน/ประกาศผล (2026-11-10).

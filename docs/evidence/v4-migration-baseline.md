# V4 migration baseline — 2026-11-01

หลักฐานสำหรับ [#139](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/139)
อ้างอิง [รายละเอียด rollout เดิม](selection-roles-deployment.md) และ [คู่มือฐาน V4](../operations/v4-baseline.md)

## สิ่งที่ตรวจแบบ read-only ในบัญชีใหม่

| รายการ | ผล |
| --- | --- |
| STS profile `coed-v4` | บัญชี `130165494095` |
| Lambda `coed-api` | Active / Successful, Node.js 22, handler `src/lambda.handler` |
| Lambda artifact ที่ใช้อยู่ | SHA-256 `5fdfb6af35d4e8fe8db092625a8a49e64e45f705d8584a6d70b8c47487ca40cf` |
| Lambda database configuration | ใช้ `coed_app` และ app secret; ไม่มี `DATABASE_URL` ใน environment |
| Cognito | Issuer และ audience ตรงกับ V4 public configuration |
| Amplify `main` | Auto-build false, active job `0000000003` |
| Public `runtime-config.js` | API, Cognito และ redirect URLs ตรงกับ `config/v4-public.json` |
| RDS `database-coed-postgres` | Available, PostgreSQL 16.15, 20 GiB gp3, `db.t4g.micro`, Single-AZ, public false, encryption true, retention 1 วัน, deletion protection true |

รอบจัดฐาน Git นี้อ่านสถานะ AWS เท่านั้น ไม่ Deploy ไม่แก้ DB/สิทธิ์ ไม่สร้างบริการเพิ่ม และไม่ปิด Lab
ไม่มีรหัสผ่าน token ค่า secret หรือข้อมูลระบุตัวตนผู้ใช้ในหลักฐานนี้

## ผลที่ผู้ใช้ยืนยัน

- 31 ต.ค. 2569: Login Student01, Coordinator01 และ Committee01–03 ได้ครบห้าบัญชี
- 1 พ.ย. 2569 เวลา 15:08 น. (Asia/Bangkok): ผู้ใช้ยืนยันว่า Flow ทำได้ครบ และส่งภาพ Student เห็นกรรมการ `3/3` พร้อมสถานะรอประกาศผล
- เจ้าของทดสอบด้วยข้อมูลจำลอง ไม่ใช่การประกาศผลการศึกษาจริง
- รายละเอียดยังผิดบางจุดตามที่ผู้ใช้แจ้ง ให้ทีมแก้ผ่าน Issues V4; ไม่ถือว่า GPA/เกรดเจ็ดวิชา อัปโหลดไฟล์จริง TU API หรือประกาศผลผ่านการตรวจรับแล้ว

## สถานะ Source และการตรวจรับ

Branch ที่เตรียมสำหรับงานนี้คือ `chore/139-v4-migration-baseline` จาก `origin/main`
ฐานก่อนแก้คือ merge commit `410eefd` ซึ่งรวม PR #138 แล้ว
โค้ด role/workflow, migration 009, รอบ private และตัวกรองบริษัทที่นำขึ้นก่อนหน้านี้ถูกรวมเป็นฐาน V4
เพิ่มเติม public config, Build target, CI และ compatibility checks ของ migrations 001–009

ผลตรวจรอบจัดฐาน V4:

| การตรวจ | ผล |
| --- | --- |
| `npm test` พร้อม PostgreSQL 16 ใน Docker | 975 Jest tests และ 94 Node tests ผ่าน รวม migrations, ACL, workflow, selection และ V4 Build; ไม่มี integration ที่ skipped เพราะขาด DB |
| Operator safety พร้อม Docker integration | 93 tests ผ่าน รวม migration dry-run/apply/reapply และการปฏิเสธประวัติ checksum ไม่ตรง |
| UI Preview | 48 UI tests และ 2 server/dependency isolation tests ผ่าน |
| Build target | Public config ตรงบัญชีใหม่แม้รับ environment เก่ามา และ strict generic build ปฏิเสธเมื่อไม่ได้ระบุ API |
| Live smoke | `npm run test:deployed-security` ผ่าน 62 test results บนบัญชีใหม่ ครอบคลุม public directory, mock-only public positions, ไฟล์เว็บ, CORS และ anonymous denials รวม Directory/Coordinator/Committee |
| Syntax / เอกสาร / ไฟล์ | 156 JavaScript modules ผ่าน syntax lint, doc-link checker ผ่าน 32 documents, diff check ผ่าน และไม่พบ credential patterns ที่ตรวจในไฟล์เปลี่ยนแปลง |

Public smoke เดิมคาดว่าบริษัททุกแห่งเป็น mock จึงปรับให้ยอมรับ provenance ของทะเบียนบริษัทที่นำเข้า
โดยยังจำกัดตำแหน่งสาธารณะเป็น mock เท่านั้น ไม่ผ่อนการตรวจ field ส่วนตัว
Live suites รันตามลำดับและเว้นช่วงให้ต่ำกว่าขีดจำกัด API เดิม 2 requests/second โดยไม่เพิ่ม quota
ลบ PostgreSQL container ที่ใช้ทดสอบแล้ว ไม่แตะฐานข้อมูล AWS

ผล local/mock, PostgreSQL integration และ anonymous live probes แยกจากผล Login ที่ผู้ใช้ยืนยัน
เจ้าของเป็นผู้ Commit, Push และเปิด PR หลังตรวจไฟล์และผลทดสอบ
CI บน GitHub และ Review ของ commit สุดท้ายยังต้องผ่านก่อน Merge/ปิด Issue

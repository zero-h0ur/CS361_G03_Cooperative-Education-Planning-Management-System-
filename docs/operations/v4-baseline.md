# V4 — AWS migration and source baseline

> Historical migration baseline (1 November 2026), not current AWS inventory. For TU/Cognito, current aliases, intake gates and verification use [current deployment](current-deployment.md), [V4 architecture](../architecture/G03-V4-architecture.md) and [documentation index](../README.md). Keep the original migration evidence below; do not reapply its operations to the current database.

งาน [#139](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/139)
ภายใต้ [V4 – Planning, Tracking & Reliability](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/milestone/4)

## ระบบที่ใช้ต่อ

| ส่วน | ฐาน V4 |
| --- | --- |
| บัญชี / Region | `130165494095 / ap-southeast-2` |
| เว็บ | <https://main.d1bpmj87vmjb96.amplifyapp.com/app.html> |
| API | <https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com> |
| Authentication | Cognito pool `ap-southeast-2_Um6nksXa1`, public client แบบไม่มี client secret |
| Compute | API Gateway JWT → Lambda `coed-api`, Node.js 22, handler `src/lambda.handler` |
| Database | RDS `database-coed-postgres`, PostgreSQL 16.15, private/encrypted, Single-AZ, `db.t4g.micro`, 20 GiB gp3 |
| Runtime DB access | `coed_app`, TLS verify-full และ app secret ผ่าน Secrets Manager VPC endpoint; ไม่มี master password ใน Lambda environment |
| Recovery | Automated backups 1 วันตามข้อจำกัดแผนบัญชี และ deletion protection; หลักฐาน restore จาก Lab แยกจากการซ้อมกู้คืนในอนาคต |
| Deploy | Manual ทั้งเว็บและ Lambda; Amplify main ปิด Auto-build |

ข้อมูล public สำหรับ Build อยู่ที่ [config/v4-public.json](../../config/v4-public.json)
ไม่มี password, token, app client secret, AWS access key หรือ DB secret value ในไฟล์นี้
DB secret references และสิทธิ์ runtime จัดการใน AWS ไม่ส่งไป Browser

## สิ่งที่ย้ายและสิ่งที่ยังค้าง

- Restore ข้อมูลต้นทางจาก Lab `676101350279 / us-east-1` และเชื่อม Cognito identity ในบัญชีใหม่ โดยรักษาประวัติเดิม ไม่แก้รหัสผ่านหรือข้อมูลใน Lab
- Apply migrations `001–009` และ runtime grants; เพิ่ม Coordinator และ Committee โดยไม่แทน Staff/Advisor บัญชีทดสอบใช้ inbox ที่เจ้าของควบคุม
- มีรอบและนักศึกษาจำลอง ผู้ใช้ทดสอบส่งแผน → Coordinator รับเรื่อง → กรรมการสามคนบันทึกความเห็น → Student เห็น `3/3` และรอประกาศผลแล้ว ดู [หลักฐาน](../evidence/v4-migration-baseline.md)
- รวมการมองเห็นรอบ private เฉพาะ cohort ที่ได้รับมอบหมาย และตัวกรองบริษัทที่มีตำแหน่งในฟอร์มแผน รายละเอียด Flow ยังให้ทีมปรับต่อ ไม่สร้างตำแหน่ง/เกรดขึ้นแทนข้อมูลที่ไม่มี
- Lab ยังไม่ปิดทั้งหมด: [#148](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/148)
- สิทธิ์ Dev/Test และบัญชีเพื่อนยังไม่ถือว่าจัดครบ: [#140](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/140)
- การซ้อม recovery และข้อจำกัด availability ติดตามใน [#146](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/146)
- V4 ส่วนที่เหลือ เช่น Deadline ประวัติ และ Flow สุดท้าย ยังต้องพัฒนาตาม Issues ไม่ถือว่าการย้ายบัญชีทำ Milestone เสร็จแล้ว

เอกสาร/คำสั่งในชื่อ V3 และ `scripts/operations/*smoke83*`, `live-challenge.py`,
`admin-account.py` ยังมีปลายทาง/guard ของ Lab เก็บไว้เพื่อประวัติและทดสอบ อย่าใช้เป็นเครื่องมือ provision บัญชีใหม่
ต้องเตรียมช่องทางสิทธิ์ของ V4 แยกใน #140 ไม่แก้ account guard หรือคัดลอก credentials เพื่อให้คำสั่งเดิมรันผ่าน

## Build และตรวจในเครื่อง

```bash
npm ci
npm run lint
npm run test:docs
npm run test:frontend
npm run test:ui-preview
npm run test:v4-build
npm run build:v4
```

`build:v4` ใช้ public configuration ที่ pin ไว้ โดยแทนค่า `CO_ED_*` ที่อาจค้างจาก Lab
ผลลัพธ์อยู่ใน `dist/` และไม่ Deploy ส่วน `npm run build` ยังใช้สำหรับ target อื่นที่ระบุเอง
เมื่อเปิด strict auth mode ต้องระบุ API และ Cognito/Origin ให้ครบ ห้ามใช้ Build ที่ไม่ได้ตั้ง auth เป็นงาน production

Full regression ใช้ PostgreSQL 16 ในเครื่องที่สร้างทิ้งได้ ตั้ง `NODE_ENV=test`,
`ALLOW_DB_RESET=true`, `TEST_DATABASE_URL` ให้ต่างจาก `DATABASE_URL`
และตั้ง integration targets ดังนี้:

| ตัวแปร | ฐานข้อมูลจำลอง |
| --- | --- |
| `TEST_DATABASE_URL` | `coed_v3_test` ในเครื่อง |
| `CO_ED_WORKFLOW_TEST_DATABASE_URL` | `coed_v3_test` ในเครื่อง; suite ใช้ schema ชั่วคราว |
| `CO_ED_SELECTION_TEST_DATABASE_URL` | `coed_selection_test` ในเครื่องเท่านั้น |

จากนั้นรัน `npm test` จะรวม selection และ V4 build guards ด้วย
Fixtures development/test เป็นข้อมูลสังเคราะห์ ไม่ควรเอาบัญชีหรือ identity mapping ที่ย้ายจริงลง Git
การจัด fixture สำหรับงานทีมเพิ่มเติมอยู่ใน #140
ตรวจ `CO_ED_TEST_DOCKER_PROVISION=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`
เมื่อมี Docker สำหรับ integration ของ operator; ไม่เรียก AWS

CI ใน [v4-verification.yml](../../.github/workflows/v4-verification.yml) ตรวจ regression, PostgreSQL,
selection, UI Preview, operator safety, docs และ production build ของบัญชีใหม่
ไม่มี AWS credentials และไม่มีขั้นตอน Deploy ใน workflow นี้

## Manual Deploy หลัง Review

การ Commit, Push, เปิด PR และ Merge เป็นคนละขั้นตอนกับ Deploy และไม่ได้อัปเดต AWS อัตโนมัติ
PR ต้องผ่าน CI และมีสมาชิกอีกคน Review ตาม [CONTRIBUTING](../../CONTRIBUTING.md)
ก่อนใช้ AWS ตรวจบัญชีให้ตรง:

```bash
aws sts get-caller-identity --profile coed-v4 --region ap-southeast-2 --query Account --output text
```

ต้องได้ `130165494095` จึงดำเนินการกับทรัพยากร V4 ได้
บันทึก commit SHA, config, checksum และ artifact ที่ต้องใช้ Rollback ก่อน Deploy

1. เว็บ: `npm run build:v4` แล้ว zip เนื้อหา **ภายใน** `dist/` ไม่ให้มีชั้นโฟลเดอร์ `dist/` ครอบ นำขึ้น Amplify app `d1bpmj87vmjb96`, branch `main` ด้วย Manual Deploy ตรวจ job สำเร็จและไฟล์ที่เสิร์ฟจริง
2. Backend: ใช้ `COED_RDS_CA_FILE` ชี้ public AWS RDS CA bundle ที่ตรวจแล้ว แล้ว `npm run package:lambda` ผลเป็น ZIP นอก checkout ไม่ใส่ `.env`, backup, credentials หรือ identity maps
3. หากต้องใช้ migration package: หลัง commit และ working tree สะอาด รัน `node scripts/operations/prepare-workflow-release.mjs <lambda.zip> <private-output-directory>` จะได้ manifest ของบัญชีใหม่และ SQL สำหรับ `001–010` ค่าเริ่มต้นเป็น Rollback ต้องตรวจ checksum, snapshot และรายงานก่อน Apply ห้ามรัน migrations ซ้ำเพียงเพราะ Merge

สำหรับการเตรียม ZIP คู่ Frontend/Backend ในเครื่องก่อนอนุมัติ Deploy ใช้
[คู่มือ Local release candidate](v4-local-release-candidate.md) รองรับ Windows
โดยไม่ต้องติดตั้ง zip/unzip และตรวจ Migration ด้วย bytes แบบ LF ที่ตรงกับ Git
Candidate ยังไม่ใช่หลักฐานว่า Deploy หรือ Apply Migration แล้ว
4. ตรวจ public API และ anonymous-denial บนบัญชีใหม่ด้วย `npm run test:deployed-security` หลัง Build ที่ตรง target คำสั่งยังใช้ชื่อไฟล์ V2/V3 ตาม contract เดิม แต่ default URLs อ่านจาก V4 public config ตัวเลือก `V2_*`/`V3_*` ยังมีไว้ใช้ระบุ target อื่นอย่างชัดเจน
5. Login ทดสอบด้วยบัญชีจำลองแยกบทบาท ผล local/mock หรือ anonymous tests ไม่แทนการตรวจสิทธิ์จริงของผู้ใช้แต่ละคน

Backend/DB/Frontend ที่ใช้อยู่ถูกเผยแพร่จาก working tree ก่อนจัดฐาน Git นี้
หลัง Merge ต้องบันทึก SHA สุดท้ายและ artifact ที่นำขึ้นจริง การตรวจ Build ใน PR ไม่ใช่หลักฐานว่า Lambda ถูก Deploy จาก SHA นั้นแล้ว
หากมีการเพิ่มบริการหรือขยายสิทธิ์ ต้องแยก scope และยืนยันก่อน ไม่เพิ่ม NAT, EC2, Proxy หรือ Multi-AZ โดยอัตโนมัติ

## ประวัติ V3

[v3.0.0](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/tree/v3.0.0)
และ [หลักฐานส่งมอบเดิม](../evidence/v3-delivery-index.md) คงเป็น snapshot เดิม
ไม่แก้ tag หรือผลทดสอบย้อนหลังให้ดูเหมือนยืนยัน V4

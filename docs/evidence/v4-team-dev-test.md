# V4 team Dev/Test verification — 2026-11-01

งาน [#140](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/140)
Branch `chore/140-team-dev-test-setup` ตาม CONTRIBUTING.md ยังให้เจ้าของ Commit/Push/เปิด PR เอง

## หลัง Merge #149

- `main` ที่ตรวจ: `5a576374540052eb3306547af8648f12eeb63b03`
- [GitHub Actions ของ main](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/41303679881) สำเร็จ
- Build เว็บจาก main แล้วเทียบกับไฟล์ที่ Amplify ให้บริการ 8 ไฟล์ ตรงกันทั้งหมด รวม authenticated bundle และ runtime configuration
- Backend: entry bundles `src/lambda.js`, `src/db/migrate.js`, RDS CA และ migrations 001–009 รวม 12 ไฟล์ ตรงกับ artifact ที่ใช้อยู่
- Lambda ZIP ที่ใช้อยู่ SHA-256 `5fdfb6af35d4e8fe8db092625a8a49e64e45f705d8584a6d70b8c47487ca40cf`
- การเปรียบเทียบ build จาก archive ที่ symlink dependencies พบ path ใน bundle ต่างกัน จึงตรวจซ้ำด้วย layout เดิมและตรวจ dependency graph ว่าไม่มี production input ถูกแก้ ผลไฟล์ entry bundles ตรงกัน byte-for-byte
- ไม่มีการ Deploy ใหม่หรือแก้ runtime permissions จากการตรวจครั้งนี้

## เครื่องมือของทีม

- เพิ่ม Compose เฉพาะ loopback พร้อม development/test DB แยกกัน ใช้ Node.js 22 ตาม runtime และ CI
- เพิ่ม fixtures 8 personas พร้อม draft, private cohort และ policy จำลองที่ระบุชัดว่าไม่ใช่ข้อกำหนดจริง
- Local API ใช้ production routes/services และ runtime SQL grants โดยตรวจลายเซ็น RS256 ของ local token; ไม่เปลี่ยน production auth boundary
- Token/keys/fixtures ของ local harness ไม่เข้า frontend หรือ Lambda artifact
- แก้ seed/reset ให้ล้าง selection data ตามลำดับ FK และคืน immutable triggers หลัง Reset โดยคง guard ป้องกัน production ไว้

## ผลตรวจ

| ชุดตรวจ | ผล |
| --- | --- |
| `CO_ED_LOCAL_DEV_TESTS=1 npm run test:local-dev` | 8 test results ผ่าน ไม่มี skipped; รวม roles, anonymous/invalid token/cross-role denial, Student submit → Coordinator → กรรมการ 3 คน, runtime ACL และ Reset หลังมี opinions |
| `npm run test:local` | Full regression 975 Jest + 94 Node tests ผ่าน พร้อม PostgreSQL จริงในเครื่อง |
| Lambda/secret และ packaging | 37 Jest + 1 packaging test ผ่าน รวมการไม่มี local fixture markers ใน Lambda |
| UI Preview/production graph | 48 UI + 2 isolation tests ผ่าน รวมไม่มี local-dev ใน production graph |
| Local API CLI + `dev:token` | `/api/v3/me` รับ signed Student token, session file mode 0600 บน macOS และลบเมื่อหยุด API |
| Syntax/doc links/diff | ผ่าน |
| IAM permission draft | AWS ValidatePolicy ไม่พบ findings; ผลนี้ไม่ใช่การยืนยัน effective access หรือ IAM Console login |

## สิทธิ์และสิ่งที่ยังต้องตรวจรับ

เจ้าของยืนยันให้สมาชิกใช้สิทธิ์พัฒนาเท่ากัน และให้บัญชีเว็บใหม่เป็น Student personas
ต่อมายืนยันให้ใช้ aliases ของกล่อง Gmail ทดสอบกลางเท่านั้น ไม่ใช้อีเมลส่วนตัวสมาชิกกับ Cognito
ข้อมูลติดต่อ AWS รายคนกับรายการ persona เว็บแยกเก็บในไฟล์ส่วนตัวนอก Git ไม่อยู่ใน fixture หรือเอกสารนี้
GitHub มี collaborators เดิมสามบัญชี: `Ronnakrit1234`, `PurinatWanthanathanya`, `nustapark6709650334`
เจ้าของยืนยันให้ใช้สิทธิ์เดิม จึงไม่เพิ่ม `ronnakrit303` และไม่ส่งคำเชิญ GitHub ซ้ำ

เจ้าของสร้าง IAM Users สามบัญชีและ Policies ด้วยตนเองแล้ว แต่ AWS รูปแบบใหม่ไม่รองรับ IAM User เข้า Console
รายชื่อ Team ในโปรเจกต์มีสมาชิกสามคนแล้วและให้ Admin ภายในโปรเจกต์ตามเอกสาร AWS
แก้คู่มือเดิมที่แนะนำ IAM Console password/MFA เป็น Team login → Assume IAM Role สำหรับ CLI แทน
ตรวจจาก STS ว่าบัญชีเป็น 130165494095 และตรวจ IAM ว่า Role ต้นทางคือ
`arn:aws:iam::130165494095:role/managed/AccountFullAccessRole` วันที่ 1 พ.ย. 2569
เตรียม Trust JSON และเจ้าของสร้าง Role ผ่าน Console แล้ว โดยไม่สร้าง Access keys
Trust JSON ผ่าน AWS ValidatePolicy โดยไม่มี findings; docs 36 เอกสาร/131 local links ผ่าน และ diff check ผ่าน
ผล validation เป็นการตรวจ Policy แยกจาก effective access
หลังสร้าง Role เจ้าของส่งผลจาก CLI profile `coed-team`:

- STS ARN: `arn:aws:sts::130165494095:assumed-role/coed-v4-dev-test-cli/coed-owner-check`
- Lambda `coed-api`: `Active`, `nodejs22.x`
- Amplify app เดิม / branch: `main`

ยืนยัน AssumeRole และ read-only จาก owner session ผ่าน ไม่ใช่ผล Login ของเพื่อนหรือการทดสอบ Deploy
ไม่ใช้สิทธิ์เจ้าของแทนเพื่อนเพื่อทำเครื่องหมายว่าตรวจรับสมาชิกครบ
Policies ของ Role ไม่ลดสิทธิ์ Team Admin ไม่มีการเปลี่ยนสิทธิ์ AWS จากการแก้คู่มือครั้งนี้

ยังไม่สร้าง Cognito users เพิ่มหรือเชื่อม Student records บน RDS ในรอบนี้
ต้องจัดบัญชี/สิทธิ์ตาม [แผนสิทธิ์ทีม](../operations/team-access.md) และให้เพื่อนยืนยันว่าเริ่มงานตาม
[คู่มือ Dev/Test](../operations/team-dev-test.md) และ Login เว็บจริงได้ จึงปิด #140

## Integration with current main

ผลแก้ conflict และการตรวจร่วมกับงานของทีมอยู่ใน [PR #151 merge verification](pr151-merge-verification.md)

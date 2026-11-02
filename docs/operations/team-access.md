# Team access — V4

สมาชิกทุกคนรับงานได้ครบ UI/API/Database/Tests ไม่มีการแบ่งตำแหน่งถาวร
ข้อมูลติดต่อและรายละเอียดส่งมอบบัญชีเก็บส่วนตัวนอก Git เอกสารแยกสิทธิ์ที่ตรวจพบกับสิ่งที่ยังเตรียมไว้

## GitHub และ Local Dev/Test

- ใช้ Collaborator เดิมสามบัญชีที่ตรวจแล้ว ไม่เพิ่มบัญชี GitHub ซ้ำ
- ทุกคนใช้ UI Preview, signed local API, PostgreSQL และแปด personas ตาม [คู่มือ Dev/Test](team-dev-test.md)
- ใช้ Branch/PR/Review/CI ตาม CONTRIBUTING ไม่ Push ลง main โดยตรง
- ไม่ใช้รหัสเจ้าของ, master DB secret, backup หรือไฟล์ identity mapping เป็นไฟล์ตั้งค่า development

## AWS Console: Team ใน AWS Settings

เจ้าของแสดงรายชื่อ Team ของโปรเจกต์ `CS361-COED` ครบทั้งสามสมาชิกแล้ววันที่ 1 พ.ย. 2569
บัญชี AWS รูปแบบใหม่นี้ให้สมาชิก Team เป็น **Admin ภายในโปรเจกต์** ไม่ใช่สิทธิ์แบบจำกัด service ตามร่าง IAM
สมาชิกสร้าง แก้ ลบทรัพยากรและอาจสร้างค่าใช้จ่ายได้ แต่จัดการสมาชิก/ลบโปรเจกต์/เปลี่ยน Billing หรือวงเงินไม่ได้
ดู [ข้อกำหนด AWS Team](https://docs.aws.amazon.com/accounts/latest/reference/invite-team-members.html)
รายชื่อสมาชิกไม่ใช่หลักฐานว่าแต่ละคน Login และทดลอง resource สำเร็จแล้ว ต้องตรวจรับรายคน

ไม่แชร์ Owner login ให้เพื่อนใช้ Team identity ของตนและเปิด MFA ที่ Builder ID/ผู้ให้บริการ Login
IAM policies ที่สร้างแยก **ไม่ลดหรือจำกัดสิทธิ์ Team Admin**
หากต้องการบังคับ least privilege จริง ต้องวางแผน access model แยก ไม่ถือว่าร่างนี้ทำให้เสร็จแล้ว

## AWS CLI: Role สำหรับงานประจำ

เจ้าของเลือกทำ IAM เพิ่มสำหรับ CLI ด้วย ส่วน Console ยังคงใช้ Team
เตรียม Role `coed-v4-dev-test-cli` ตาม [คู่มือสร้าง Role](iam-team-setup.md)
สมาชิก Login ผ่าน Team รายคนแล้ว Assume Role ด้วย credentials ชั่วคราว ไม่มี Access key ถาวร
Trust จำกัด Role ต้นทางที่ตรวจจาก AWS จริง ไม่เชื่อถือ Principal ทุกบัญชี
เจ้าของสร้าง Role แล้ว และส่งผลทดสอบ AssumeRole, Lambda และ Amplify ผ่านวันที่ 1 พ.ย. 2569
ยังต้องให้สมาชิกแต่ละคน Login และทดสอบจาก Team identity ของตนเอง

| ส่วน | ขอบเขตเมื่อใช้ CLI Role |
| --- | --- |
| Amplify | อ่าน app/branch/job และ Manual Deploy เฉพาะ main ของ app เดิม |
| Lambda | อ่าน config/code และ UpdateFunctionCode เฉพาะ coed-api ใน Sydney |
| API Gateway / Cognito | อ่าน API/pool เดิมและข้อมูลผู้ใช้ ไม่เปลี่ยน auth หรือ reset บัญชีอื่น |
| CloudWatch | อ่าน logs ของ coed-api |
| RDS / Network | อ่าน metadata ใน Sydney; ทำ schema development ในเครื่องและให้ owner ดูแล Cloud migration |

[v4-team-dev-test-policy.json](../../config/iam/v4-team-dev-test-policy.json) เป็น permission policy ที่เตรียมไว้
เจ้าของสร้าง customer-managed policy/Role และทดสอบอ่าน Lambda/Amplify ผ่านแล้ว
ผลนี้ยืนยันการใช้งานของ owner session ไม่ใช่ผลตรวจรับของสมาชิกทั้งสามคนหรือการทดสอบ Deploy
CLI Role ไม่ให้สร้าง EC2/NAT/RDS/Proxy, เปลี่ยน IAM/network/DB protection/Billing หรืออ่าน secret value โดยตรง
ผู้เปลี่ยน Lambda code ยังอาจเข้าถึง app secret/ข้อมูลแอปผ่าน runtime role ได้ ผู้ Deploy ต้องผ่าน Review/CI
สมาชิกอาจใช้สิทธิ์ Admin ผ่าน Team profile ได้ตามเดิม ต้องประสานการใช้ shared resources กัน

## Deploy และการถอนสิทธิ์

- Amplify main ปิด Auto-build: Merge ไม่ Deploy อัตโนมัติ ใช้ [คู่มือฐาน V4](v4-baseline.md)
- ตรวจ PR/CI, commit SHA, artifact/checksum และ rollback ก่อนเผยแพร่ ไม่ Deploy ทับงานเพื่อนโดยไม่ประสาน
- ถอด CLI Role: owner จัดการ policy/trust และ revoke sessions ตามจำเป็น
- ถอนสมาชิกจาก Console/โปรเจกต์: จัดการ AWS Settings Team ด้วย การถอด Role ไม่ถอน Team Admin
- ถอน GitHub แยกที่ Repo access และปิดบัญชี/ขอบเขตทดสอบแอปที่เกี่ยวข้องตามจริง

## บัญชีเว็บทดสอบ

เจ้าของเลือก Student personas เพิ่มโดยใช้ plus aliases ของ Gmail ทดสอบกลางที่ตนควบคุม
ไม่ใช้อีเมลมหาวิทยาลัยของสมาชิกกับ Cognito และไม่แชร์รหัสกล่อง Gmail/Owner AWS
สิทธิ์ AWS/GitHub และ role ภายในแอปเป็นคนละเรื่อง ทุกคนใช้ทุก persona ใน local harness ได้

Cognito pool ปัจจุบันใช้ email เป็น username แต่ละ persona ต้องใช้ email ไม่ซ้ำและรับ invitation/reset ได้
ดู [ข้อกำหนด Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html)
การสร้าง/เชื่อม Student เพิ่มบน RDS และส่ง invitation ยังไม่ดำเนินการในชุดโค้ดนี้
ต้องตรวจ identity เดิม, scope จำลอง, audit และคืนสิทธิ์ DB ชั่วคราวก่อนถือว่าจบ
การใช้ Lambda/master secret ชั่วคราวกับงานใหม่นี้ต้องให้เจ้าของอนุมัติงานที่เตรียมไว้โดยเฉพาะ

## ก่อนปิด #140

- [x] ตรวจ GitHub access ใช้ Collaborators เดิมสามบัญชี
- [x] มี Local Dev/Test, fixtures และผลทดสอบในเครื่องผู้จัดเตรียม
- [x] พบสมาชิก Team ครบสามคนและบันทึกข้อจำกัด Admin/วิธี Deploy/ถอนสิทธิ์ตามจริง
- [x] เจ้าของสร้าง CLI Role และส่งผล AssumeRole/read-only ผ่าน; สมาชิกยังต้องทดสอบรายคน
- [ ] จัด Student personas เพิ่มและเชื่อม scope บนเว็บจริงพร้อม audit/cleanup
- [ ] สมาชิกแต่ละคนยืนยัน Login เว็บและทำ Dev/Test จากเครื่องตนได้
- [ ] เจ้าของ Commit/Push/เปิด PR, CI ล่าสุดผ่าน, เพื่อน Review และ Merge ตาม CONTRIBUTING

จนกว่าตรวจรับครบใช้ Refs #140 ไม่ปิด Issue เพียงเพราะมีไฟล์ Policy หรือรายชื่อ Team

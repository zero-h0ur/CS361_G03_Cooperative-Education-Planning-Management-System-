# ตั้ง IAM Role สำหรับ CLI ของทีม V4

เจ้าของสร้าง Role ผ่าน Console ตามคู่มือนี้ JSON เป็นไฟล์เตรียมการ ไม่ได้ Apply ให้แล้ว
ใช้บัญชี `130165494095` / Sydney (`ap-southeast-2`) สมาชิกใช้ Team login ของตนเอง ไม่มีบริการรายเดือนเพิ่ม

## บัญชี AWS รูปแบบใหม่

โปรเจกต์นี้ใช้ AWS Settings / Team สมาชิกมีสิทธิ์ Admin ภายในโปรเจกต์ที่แชร์
AWS รูปแบบนี้ไม่รองรับ IAM User เข้า Console ขั้นตอน IAM Console password/MFA และ Login เป็น IAM User
ในคู่มือฉบับก่อนจึงใช้กับบัญชีนี้ไม่ได้ ดู [AWS IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)
และ [สิทธิ์ Team](https://docs.aws.amazon.com/accounts/latest/reference/invite-team-members.html)

CLI จะ Login ผ่าน Team แล้ว Assume IAM Role ที่จำกัดสิทธิ์สำหรับงานประจำ
**Role ไม่ลดสิทธิ์ Admin ทาง Team** สมาชิกยังเลือกใช้ Team profile โดยตรงได้ จึงไม่ใช่การบังคับ least privilege ทั้งบัญชี
IAM Users สามบัญชีที่เจ้าของสร้างไว้ไม่ใช้ในวิธีนี้ ไม่ต้องสร้าง Access keys หรือแจก password เพิ่ม
`COEDV4SelfService` ไม่ใช้ตั้ง MFA ของ AWS Builder ID และไม่เปิด Console ให้ IAM User ในบัญชีรูปแบบนี้
เจ้าของตรวจและลบ Users/Policy ที่ไม่ใช้ได้แยกต่างหาก หลังยืนยันว่าไม่มีงานพึ่งพา

## 1. เจ้าของสร้าง Role

เข้า **IAM → Roles → Create role → Custom trust policy**:

1. วาง [v4-team-cli-trust-policy.json](../../config/iam/v4-team-cli-trust-policy.json) แล้ว Next
2. เลือกเฉพาะ `COEDV4DevTest` ที่สร้างไว้แล้ว แล้ว Next
3. Role name: `coed-v4-dev-test-cli`
4. Description: `CO-ED V4 CLI role for project team members with scoped development and deployment access.`
5. ตรวจ Trust/Policy แล้ว Create role ใช้ Session duration 1 ชั่วโมง

Trust จำกัดเฉพาะ `arn:aws:iam::130165494095:role/managed/AccountFullAccessRole`
ตรวจ ARN จริงจาก IAM แล้ววันที่ 1 พ.ย. 2569 ไม่ใช้ Principal `*` หรือเชื่อถือทุกบัญชี
DevTest policy ต้องตรงกับ [v4-team-dev-test-policy.json](../../config/iam/v4-team-dev-test-policy.json)
ไม่แนบ SelfService, AdministratorAccess หรือ FullAccess ให้ Role นี้
ส่วน `signin:*` ใน Policy เดิมไม่ได้ใช้สำหรับ Assume Role; Login ต้นทางใช้สิทธิ์ Team

## 2. สมาชิกตั้ง CLI ของตนเอง

ใช้ AWS CLI 2.32.0+ และ MFA ของ AWS Builder ID/ผู้ให้บริการที่แต่ละคนใช้ Login
ไม่แชร์ password, QR หรือ OTP Login ด้วย Team ของตนและเลือกโปรเจกต์ `CS361-COED` บัญชี `130165494095`:

```bash
aws login --profile coed-team-source --region ap-southeast-2
aws sts get-caller-identity --profile coed-team-source --region ap-southeast-2 --query '{Account:Account,Arn:Arn}' --output json
```

Source ARN ควรเป็น session ของ `AccountFullAccessRole` ในบัญชีนี้
คำสั่งต่อไปนี้เขียนเฉพาะ AWS config ในเครื่องผู้รัน:

```bash
aws configure set role_arn arn:aws:iam::130165494095:role/coed-v4-dev-test-cli --profile coed-team
aws configure set source_profile coed-team-source --profile coed-team
aws configure set region ap-southeast-2 --profile coed-team
aws configure set duration_seconds 3600 --profile coed-team
```

ตั้งชื่อ Session ของตัวเองหนึ่งคำสั่ง:

| สมาชิก | คำสั่ง |
| --- | --- |
| ณัษฐภาคย์ | `aws configure set role_session_name coed-nustapark --profile coed-team` |
| รณกฤต | `aws configure set role_session_name coed-ronnakrit --profile coed-team` |
| ภูริณัฐ | `aws configure set role_session_name coed-purinat --profile coed-team` |

ชื่อ Session เป็นชื่อที่ผู้ใช้ตั้ง ไม่ใช่หลักฐานยืนยันตัวตนโดยลำพัง ตรวจ CloudTrail กับ session ต้นทางประกอบ
CLI รับ credentials ชั่วคราวให้อัตโนมัติ ไม่ต้องคัดลอก access key/secret ลง Repo หรือแชต
Role chaining ใช้ Session ไม่เกิน 1 ชั่วโมง Login ต้นทางใหม่เมื่อหมดอายุ

## 3. ตรวจแบบอ่านอย่างเดียว

```bash
aws sts get-caller-identity --profile coed-team --region ap-southeast-2 --query '{Account:Account,Arn:Arn}' --output json
aws lambda get-function-configuration --profile coed-team --region ap-southeast-2 --function-name coed-api --query '[State,Runtime]' --output json
aws amplify get-branch --profile coed-team --region ap-southeast-2 --app-id d1bpmj87vmjb96 --branch-name main --query 'branch.branchName' --output text
```

Account ต้องเป็น `130165494095`, ARN เป็น `assumed-role/coed-v4-dev-test-cli/<ชื่อ session>`
และสองคำสั่งทรัพยากรต้องอ่านได้ ไม่ Deploy หรือรันคำสั่งลบเพื่อทดสอบสิทธิ์
ทุกคนใช้ `--profile coed-team` กับงาน Cloud ประจำ และประสาน Review/CI ก่อน Manual Deploy
ผู้แก้โค้ด Lambda อาจเข้าถึงข้อมูลแอปผ่าน runtime role ได้ตาม [แผนสิทธิ์ทีม](team-access.md)

## 4. ถอนสิทธิ์และแก้ปัญหา

- ถอน CLI Role: เจ้าของถอด DevTest policy/แก้ Trust และ Revoke sessions ตามความจำเป็น
- ถอนสมาชิกออกจากโปรเจกต์: ทำใน **AWS Settings → Team / Project members** ด้วย การถอด IAM Role ไม่ถอน Team Admin
- AssumeRole ถูกปฏิเสธ: ตรวจ source ARN, Trust และ Policy ไม่แก้ด้วย FullAccess
- ARN เป็น AccountFullAccessRole: กำลังใช้ Source profile ให้เปลี่ยนเป็น `--profile coed-team`
- Login หมดอายุ: รัน `aws login --profile coed-team-source --region ap-southeast-2` ด้วยตัวตนของตน
- Session duration เกิน: ใช้ `3600` เพราะต้นทางเป็น Role session

อ้างอิง [AWS CLI login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html),
[CLI role profiles](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-role.html)
และ [STS AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)

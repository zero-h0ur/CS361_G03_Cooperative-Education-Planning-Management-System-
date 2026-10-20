# ผลทดสอบระบบที่ deploy แล้ว — V3 #83

ทดสอบวันที่ 20 ต.ค. 2569 บน main ด้วยบัญชีและ fixtures จำลอง แยกจากแผนที่ใช้สาธิต

- Frontend: `https://main.d1d9qrqnsi5nl6.amplifyapp.com`
- API: `https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com`
- Application source ตอนทดสอบ: `d13868d47d9ec7fc7ce26b67b131f97191817df5`
- [PR #125](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/125) / [CI #35](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/39325108475)
- ผลตรวจรับหลังแก้ Logout เพิ่มใน #84: [สรุปส่งมอบ](../evidence/v3-delivery-index.md)

## ผลการทดสอบ

| ชุดทดสอบ | ผล |
| --- | --- |
| V2 public regression | 10/10 ผ่าน |
| V3 anonymous, malformed token, CORS, error และ public write denial | 40/40 ผ่าน |
| Advisor GET matrix | 17/17 ผ่าน เห็นเฉพาะนักศึกษา 3 คนที่ได้รับมอบหมาย นอก assignment ได้ 403 |
| Staff GET matrix | 15/15 ผ่าน ค้นหา/อ่านเฉพาะ scope นอก scope ได้ 403 |
| Student GET matrix | 11/11 ผ่าน อ่านข้อมูลและแผนของตนได้ แผนของผู้อื่นได้ 403 |
| Advisor mutations | ปฏิเสธ 14/14: 8 policy 403 และ 6 unsupported-method 405 |
| Student mutations ข้ามเจ้าของ | ปฏิเสธ 4/4 ด้วย 403 |
| Staff review นอก scope | ปฏิเสธ 3/3 ด้วย 403 ก่อนตรวจ state |
| DB ก่อน/หลัง probes | Counts/fingerprints ของ 11 ตาราง และสรุปแผนทดสอบ 4 รายการตรง baseline เดิม |
| Browser | Advisor เห็น 3 คนและอ่านอย่างเดียว; ทั้ง 3 roles Logout แล้วต้อง Login ใหม่ ไม่มีข้อมูลบัญชีเดิมค้าง |
| รอ token หมดอายุจริง | SKIPPED ไม่รวมเป็นผลผ่าน |

ชุดปฏิเสธคำสั่งยืนยันได้เฉพาะการกันผู้ไม่มีสิทธิ์ ไม่ใช่ผลทดสอบการอนุมัติแผนสำเร็จบน RDS โดย Staff ใช้แผน DRAFT นอก scope เพื่อตรวจว่าระบบเช็กสิทธิ์ก่อนสถานะ ส่วนการเปลี่ยนสถานะสำเร็จและ transaction rollback ทดสอบแยกใน [T03](../evidence/v3-t03-workflow-transitions-concurrency.md)

ไฟล์ผลทดสอบ:

- [Public/anonymous TAP report](evidence/v3-t05-public-20261020.txt) — 50 checks และ 2 parent suites
- [Operator tests](evidence/v3-t05-operator-tests-20261020.txt) — 87 tests รวม PostgreSQL local 14 cases
- [Full regression](evidence/v3-t05-full-regression-20261020.txt) — 885 tests

## Fixtures และขอบเขตการทดสอบ

สร้าง Advisor จำลอง 1 บัญชี ผูก internal role/identity และ assignment อายุ 7 วันให้ `SMOKE830001–SMOKE830003` ส่วน `SMOKE830004` อยู่นอก assignment/Staff scope มีแผน 4 รายการเริ่มที่ DRAFT, SUBMITTED, UNDER_REVIEW และ DRAFT ทุกแผน version 1, audit 1 แถว และ operation 0 แถว

บัญชี Cognito อย่างเดียวไม่ให้สิทธิ์ในระบบ ต้องมี active identity link และ assignment ด้วย ไม่แก้ role ของบัญชีเดิมหรือแผนสาธิตเพื่อเตรียมผลทดสอบ หาก assignment หมดอายุควรทบทวนก่อนทดสอบใหม่ ไม่เปลี่ยน scope เพื่อให้ผลผ่าน

## รันทดสอบอีกครั้ง

### Public/anonymous

Build จาก source ที่จะตรวจด้วย public config ของ target ก่อน แล้วรัน:

```bash
npm run test:deployed-security
```

ชุดนี้เรียก AWS จริงและไม่รวมใน `npm test` ตรวจ hosted bytes เทียบ `dist/` ด้วย จึงต้องใช้ config/source ให้ตรงกัน ไม่ยอมรับ build เก่าแทนรุ่นใหม่

### บัญชีที่ Login แล้ว

Scripts อยู่ใน [scripts/operations](../../scripts/operations) และ pin target/account/hash ของ release เดิม ต้องตรวจเงื่อนไขใน script ก่อนใช้กับรุ่นใหม่ โดยเฉพาะ provisioning และ mutation probes ห้ามรันซ้ำแบบไม่ตรวจสถานะ:

| Script | หน้าที่ |
| --- | --- |
| `create-smoke83-advisor.py` | สร้างหรือ resume บัญชี Advisor จำลองที่ทำเครื่องหมายไว้ ไม่ส่ง invitation |
| `run-smoke83-provision.py` + `provision-smoke83-fixtures.sql` | สร้างและตรวจ identity/assignments/fixtures แบบจำกัด |
| `read-smoke83-roles.py` | GET matrix ของ Student/Staff/Advisor |
| `checkpoint-smoke83-db.py` | Capture และ verify baseline แบบ read-only ผ่าน VPC CloudShell |
| `deny-smoke83-mutations.py` | Negative write probes เฉพาะ fixtures ที่กำหนด |
| `scan-smoke83-logs.py` | สแกน logs แบบ bounded aggregate |

ตัวช่วย read/deny ใช้ Access Token ของบัญชีจำลองผ่าน hidden prompt เท่านั้น ไม่ใช้ ID/refresh token และไม่ส่ง token ผ่าน args, ไฟล์ หรือ output

ก่อน negative probes ต้อง capture baseline ใน VPC CloudShell เก็บไว้ส่วนตัวและหยุดการแก้ข้อมูลอื่นชั่วคราว รัน Advisor ก่อนแล้วตรวจ baseline จากนั้นจึงทำ Student/Staff และตรวจ baseline เดิมอีกครั้ง หากได้ผลไม่คาดหมายหรือ timeout ให้หยุดและตรวจ DB ห้าม retry/reset/recapture baseline เพื่อให้ผลผ่าน เพราะ request ที่สำเร็จผิดคาดอาจเปลี่ยน fixture ได้

## Log sampling

ตรวจ Lambda logs ช่วง UTC 2026-10-19 19:43–19:45 และ 20:27–20:51 รวม 352 records / 31,097 bytes / 117 Lambda starts ไม่พบ pattern JWT, bearer, credential, private fields/claims, email หรือ synthetic canary ที่กำหนด

เป็น heuristic sample ของ Lambda เท่านั้น ไม่ครอบคลุมทุกข้อความ ทุกเวลา หรือทุกบริการ API Gateway access logs ไม่ได้เปิดใน stage นี้ ตัวช่วยไม่พิมพ์หรือบันทึก raw log และไม่เปลี่ยน logging settings

## ข้อจำกัดและงานต่อ

- การรอ token หมดอายุจริงยังไม่ได้ทดสอบ
- Browser Logout ของ #83 ยังไม่ใช่หลักฐาน RevokeToken; ตรวจเพิ่มครบสาม roles หลัง PR #127 ใน [#84](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/84#issuecomment-6293912895) แล้ว แต่ยังไม่ได้ลองใช้ refresh token เก่าซ้ำ
- ชุดทดสอบใช้ข้อมูลจำลอง ไม่ใช่การอนุมัติใช้ข้อมูลนักศึกษาจริง
- ดูข้อจำกัด session, IAM, credentials เก่า และงานต่อใน [คู่มือพัฒนา](v3-operating-guide.md#งานต่อ-v4)

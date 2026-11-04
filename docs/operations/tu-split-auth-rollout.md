# TU Login: ขอบเขต AWS และแผนเปิดใช้งาน

สถานะ: โค้ดและการทดสอบในเครื่องเท่านั้น ไม่ใช่การอนุมัติ Deploy
วันที่เสนอ: 4 พฤศจิกายน 2026, เวลาไทย

## เส้นทางใหม่

Browser -> TU broker -> TU API -> private session issuer -> RDS -> token

TU broker ตรวจรหัสผ่านกับมหาวิทยาลัย ส่วน private issuer ตรวจเจ้าของบัญชีจริงก่อน
ออก token อายุ15นาที ทั้งสองฝั่งต้องผ่าน ไม่มีบัญชีสมมติหรือ fallback นักศึกษาคนอื่น
Student ใช้ TU; Coordinator/Committee ยังใช้ Cognito และฐานข้อมูลใบสมัครชุดเดิม

| ส่วน | หน้าที่ | สิ่งที่ไม่มีสิทธิ์ถือ/ทำ |
| --- | --- | --- |
| `coed-tu-auth` | ตรวจ TU แล้วเรียก issuer ผ่าน IAM | ไม่มี DB password, signing private key หรือสิทธิ์สร้างบัญชี |
| `coed-tu-session-issuer` ใหม่ | ตรวจ identity ใน RDS และออก token | ไม่มี TU password/key, ไม่มี public route และเขียนข้อมูลไม่ได้ |
| `coed-api` | ตรวจ token/identity ปัจจุบันและทำงานตาม role เดิม | ไม่รับ TU password และไม่เชื่อคำกล่าวอ้าง role จาก Browser |

IAM เป็นขอบเขตความเชื่อถือของ issuer ไม่ใช่ชื่อ field ใน event การทดสอบ policy
ในเครื่องยังไม่แทนผล AccessDenied บน AWS จริง การผูกบัญชีเดิมที่ยังขาดต้องอนุมัติ
แยกต่างหาก Login จะไม่สร้าง/ย้าย/เปิดบัญชีให้อัตโนมัติ

## รายการเปลี่ยนที่ต้องขออนุมัติแยก

บัญชี130165494095, region `ap-southeast-2` เท่านั้น ต้องตรวจ drift อีกครั้งก่อนทำจริง
ข้อเสนอที่อ่านได้ด้วยโค้ดอยู่ใน `scripts/operations/tu-auth-deployment-plan.mjs`
ซึ่งเป็น pure generator ไม่มี AWS client หรือคำสั่ง apply

| ทรัพยากร | ข้อเสนอ | ไม่เปลี่ยน |
| --- | --- | --- |
| TU broker เดิม | handler `src/tu-auth-broker.handler`, Node24,128MB, timeout20s; publish candidate/live alias | ไม่ใช้ ZIP API หลักทับ |
| Issuer ใหม่1ตัว | `src/tu-session-issuer.handler`, Node22,256MB, timeout8s, reserved concurrency2, pool1 | ไม่มี URL/HTTP integration/event source สาธารณะ |
| Network | ใช้ VPC/subnet/SG เดิมตาม manifest; ตรวจ5432 RDS และ443 Secrets endpoint | ไม่เพิ่ม NAT/EIP/endpoint ไม่เปิด RDS หรือขยาย CIDR |
| Broker IAM | GetSecretValue เฉพาะ TU key; InvokeFunction เฉพาะ issuer alias | ไม่เพิ่ม DB/signing secret หรือ wildcard Invoke |
| Issuer IAM | เฉพาะ DB/signing secrets, log streams และ ENI ที่จำเป็น | เพิ่ม Deny สำหรับการเรียก ENI API จากโค้ดตัวเอง |
| Issuer resource policy | Deny Invokes ยกเว้น broker role กับ operator role ที่ระบุจริง | ไม่ให้ Gateway/API role/บัญชีอื่นเรียก issuer |
| Gateway | TU integration `sr47ns9` ชี้ broker alias; invoke permission ตรง2 TU routes; safe access log | ไม่แก้ Cognito authorizer, CORS หรือ route อื่น |
| DB role ใหม่ | `coed_tu_login`: SELECT คอลัมน์ identity ที่จำเป็นเท่านั้น | ไม่แก้ข้อมูลผู้ใช้/ใบสมัคร/ประวัติ |
| Secrets | ไม่เกิน3รายการ/versions ที่ตรวจแล้ว: TU key ที่หมุนใหม่, signing keypair, DB login | ไม่ใส่ค่าใน Git, ZIP, command line, log หรือ Browser |
| Logs/limits | retention14วัน; login throttle เสนอ0.2/s burst2; standard alarms2รายการ | ไม่มี provisioned concurrency, WAF หรือ DynamoDB เพิ่มเงียบ ๆ |

ตัวเลข timeout/concurrency/throttle เป็นค่าเริ่มต้นที่เสนอ ต้องทดสอบ cold/warm
และยืนยันภาระจริงก่อนอนุมัติ AWS การตั้ง Gateway throttle เป็น best-effort
ไม่รับประกันโควตา TU1000ครั้ง/ชั่วโมง/key โดยเฉพาะเมื่อ key มีผู้ใช้อื่น
Issuer ตัดงานที่7วินาที และต้องกำหนด `DB_CONN_TIMEOUT=1000`,
`DB_QUERY_TIMEOUT=1000` เป็นค่าเริ่มต้น (โค้ดยอมรับไม่เกิน1500ms) ไม่ปล่อย DB
ที่ตอบช้ากลับมาออก token หลังหมดเวลา และไม่อ้างว่าเวลาที่วัดในเครื่องคือ AWS cold start

### การเตรียม DB role

`scripts/operations/tu-login-role.sql` เป็น SQL สำหรับ owner ตรวจและทดลองแยก
สร้าง role เป็น **NOLOGIN** โดยไม่ใส่ password และให้ SELECT เฉพาะคอลัมน์ที่ใช้
ตัว operator ต้องตั้ง LOGIN/credentials ผ่านกระบวนการลับที่อนุมัติภายหลัง

SQL จะตรวจ effective PUBLIC/inherited privileges และปฏิเสธสิทธิ์เขียน persistent
schema/table, อ่านคอลัมน์นอกขอบเขต, membership/role escalation และ application
routine ที่เรียกได้ ไม่ถอนสิทธิ์ PUBLIC/เจ้าของอื่นเงียบ ๆ ไม่แก้ historical migrations
ฟังก์ชัน extension ที่ไม่ใช่ SECURITY DEFINER ไม่ถูกนับเป็น application routine
PostgreSQL built-ins และ temporary-object privileges ไม่ใช่สิทธิ์แก้ข้อมูลถาวร
จึงยังต้องตรวจ DB policy ของเป้าหมายจริง ไม่อ้างว่า role ไม่มี SQL capability ทุกชนิด

ถ้า production schema/checksum ไม่ตรง local lineage ให้หยุด ไม่มีการรัน013ซ้ำ
หรือรัน014/017เพื่อเดาว่าจะช่วยแก้ Login และไม่มีการ seed mockup ลงฐานจริง

## ค่าใช้จ่ายที่เสนอ ไม่ใช่เพดานบิล

อ่าน AWS regional Price List สำหรับ Sydney เมื่อ2026-11-04 ไม่สมมติว่าเหลือ Free Tier
และยังไม่มีทรัพยากรใดถูกสร้างจากงานนี้

| รายการ | อัตรา USD ที่ใช้คำนวณ |
| --- | --- |
| Lambda x86 on-demand | $0.20/ล้าน requests, $0.0000166667/GB-second tierแรก |
| Secrets Manager | $0.40/secret/เดือน, $0.05/10000 API calls |
| CloudWatch standard logs | ingestion $0.67/GB, storage $0.033/GB-month |
| Standard metric alarms | $0.10/metric alarm-month |

แหล่งราคาสาธารณะ: [Lambda Sydney](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-southeast-2/index.json)
(เผยแพร่2026-10-30), [Secrets Sydney](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-southeast-2/index.json)
(2026-09-11), [CloudWatch Sydney](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-southeast-2/index.json)
(2026-10-07). คำอธิบาย billing: [Lambda](https://aws.amazon.com/lambda/pricing/),
[Secrets](https://aws.amazon.com/secrets-manager/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/).

ตัวอย่าง10000 Login/เดือน: broker128MB เฉลี่ย1s + issuer256MB เฉลี่ย0.25s,
รวม20000 Lambda requests,3 secrets, เผื่อ30000 secret calls โดยไม่หัก cache,
logs0.1GB/storage0.05GB และ2 alarms จะประมาณ **$1.65/เดือน** สำหรับชุดที่คำนวณนี้
ถ้า100000 Login และ logs/storage เพิ่ม10เท่า จะประมาณ **$3.94/เดือน**
ตัวเลขรวม broker ที่มีอยู่แล้ว ไม่ใช่การวัดค่าเพิ่มจากบิลเดิมทั้งหมด

ไม่รวม API Gateway/RDS/endpoint เดิม ภาษี ค่าเงิน transfer หรือ KMS CMK ที่อาจต้องใช้
cold starts, retries ของผู้ใช้, การโจมตี และปริมาณ log อาจเปลี่ยนบิลได้ ต้องยืนยันราคา
ยอดใช้งานร่วม โควตา และงบกับผู้อนุมัติก่อน Deploy ไม่รับประกันว่าใช้ฟรี

## ลำดับเปิดใช้งานหลังอนุมัติ AWS

1. ตรวจ account/region, source/artifact hashes, migration history, grants, identity
   ของบัญชีทดสอบ และสำรองก่อน DDL; ถ้าไม่มี link ที่ยืนยันแล้วให้หยุดขออนุมัติผูกแยก
2. resolve secret ARNs/operator role จริงก่อนสร้าง policy ตรวจ endpoint policy และ
   signing/public-key agreement โดยไม่พิมพ์ค่า เปลี่ยน TU key ที่เปิดเผยแล้วอย่างปลอดภัย
3. เตรียม issuer NOLOGIN role/secret/IAM ตามขอบเขตที่อนุมัติ และ publish candidate
   ของ issuer/broker โดยยังไม่สลับ public traffic ตรวจนโยบาย Deny API ที่รองรับจริง
   ห้ามใช้ policy replacement จนลบสิทธิ์เดิมโดยไม่รู้ตัว
4. พิสูจน์ negative cases, IAM outsiders ถูกปฏิเสธ, secret/DB/signing unavailable
   ไม่ออก token และไม่เขียนข้อมูล ก่อนชี้ TU integration ไป qualified broker alias
5. Default Gateway stage auto-deploy การแก้ integration มีผลจริง จึงสลับเฉพาะจุด
   ที่อนุมัติ หากเปลี่ยน signing key ให้แจ้ง Student ว่าต้อง Login ใหม่ ไม่กระทบ Cognito
6. ขออนุญาตบัญชีทดสอบแบบจำกัดอีกครั้ง ใช้ no-echo input ตรวจ Login และ `/me`
   เท่านั้น ไม่พิมพ์ token/profile และไม่ส่งใบสมัคร/ยืนยันสิทธิ์/เรียก GET ที่มี lazy mutation
7. ติดตามอย่างน้อย30นาทีและช่วงใช้งานจริงถัดไป:5xx, timeouts, rate limits,
   provider/Invoke/identity/signing categories และ DB connections

สำเร็จเมื่อบัญชีที่ถูกต้องผ่านถึง `/me`, ผู้ไม่มีสิทธิ์ถูกปฏิเสธ, ไม่มีข้อมูลเขียนจาก Login
และ Coordinator/Cognito ไม่ถดถอย ไม่ใช่เห็น200จาก TU เพียงอย่างเดียว

## Rollback

ย้อนเฉพาะ strict version/config ที่พิสูจน์แล้ว หากยังไม่มี baseline ที่ปลอดภัย
ให้เปิด `TU_LOGIN_MAINTENANCE=true` ส่ง503ที่อธิบายได้ โดยคง Coordinator และข้อมูลเดิม
ไม่ย้อนกลับไป arbitrary-Student/auto-provisioning fallback ไม่ลบตาราง audit หรือ
ย้อน migration/identity links อัตโนมัติ ปิด resource/ถอนสิทธิ์ใหม่ได้หลังตรวจ dependency

## สิ่งที่ยังไม่อนุมัติ

ไม่มี AWS mutation, DB role/grants จริง, migration, relink/backfill, live TU testซ้ำ,
push หรือ Deploy จาก Phase1 การตรวจ diff/commit ในเครื่องและรัน release gate ซ้ำ
ได้รับอนุมัติเพิ่มภายหลังเท่านั้น ดู [ผลตรวจในเครื่อง](../evidence/tu-split-auth-local.md)
และ [ผลตรวจหลัง commit](../evidence/tu-post-commit-release-gate.md) ก่อนขออนุมัติขั้นถัดไป

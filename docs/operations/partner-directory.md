# ข้อมูลสถานประกอบการปีการศึกษา 2569

ชุดนำเข้ารอบแรกมี 103 รายการบริษัทและ 56 ตำแหน่ง ใช้รหัสทะเบียนเดิมผูก UUID แบบคงที่ บริษัทเดิมและแผนที่อ้างอิงอยู่ไม่ถูกลบหรือเปลี่ยนรหัส

ชื่อบริษัท ที่ตั้งและโลโก้เปิดดูได้โดยไม่ Login ส่วนตำแหน่ง อัตราและช่วงเวลาต้องผ่าน Access Token และบัญชี Student / Staff / Advisor ที่ backend ตรวจแล้ว ไม่มีชื่อผู้ติดต่อ อีเมลหรือเบอร์โทรของตัวแทนบริษัทในชุดนำเข้า

## การเตรียมข้อมูล

ตัวนำเข้าอ่านเฉพาะคอลัมน์ที่อนุญาตจาก CSV ต้นฉบับ จับคู่ด้วยชื่อบริษัท ไม่ใช้การค้นหาชื่อแบรนด์บางส่วน หากจับคู่ไม่ได้จะหยุดให้ตรวจ ไม่เติมจังหวัดหรือช่วงเวลาเอง และไม่ตั้งสถานะ `verified` อัตโนมัติ

```bash
node scripts/import-companies-csv.mjs \
  --input /absolute/private/registry.csv \
  --forms /absolute/private/forms.csv \
  --output-directory /absolute/private/output
```

โฟลเดอร์ผลลัพธ์ต้องอยู่นอก repository และมี permission `0700` ได้ไฟล์ `partner-import.json` กับ `partner-import.sql` แบบ `0600` ไฟล์ CSV ต้นฉบับและผลลัพธ์สองไฟล์นี้ไม่ต้อง commit ส่วน `data/companies.json` เป็นทะเบียนสาธารณะ ไม่มีรายละเอียดตำแหน่ง และไม่ได้ใช้แทน API บนเว็บ

ทะเบียนมีชื่อซ้ำสองกลุ่มคือ C02/C42 และ C51/C69 ยังคงเก็บรหัสบริษัทครบ แต่ผูกประกาศกับรหัสแรกของชื่อเดียวกันเพื่อไม่คัดลอกประกาศซ้ำ อัตรารับเป็นยอดตามประกาศ ไม่ใช่ยอดต่อชื่อตำแหน่ง จึงห้ามนำมารวมซ้ำ

ข้อมูลนี้ยังต้องตรวจความถูกต้องและสถานะรับสมัครกับองค์กรต้นทาง โดยเฉพาะประกาศเก่า โลโก้ และรายการที่ไม่ระบุจังหวัด ไม่ใช้การมีประกาศเป็นหลักฐานว่าปัจจุบันยังเปิดรับ

## ลำดับขึ้นระบบ

1. ตรวจบัญชี AWS, RDS เป้าหมายและ snapshot ก่อนทำงาน เก็บ SHA-256 ของ ZIP/SQL ที่ผ่านการตรวจ อย่าใช้ `seed` หรือ reset กับ RDS
2. ทดสอบ SQL แบบ dry run จาก VPC CloudShell ผ่าน TLS `verify-full` ใช้บัญชี operator และรหัสผ่านแบบ hidden prompt ค่าเริ่มต้นของไฟล์คือ `apply=false` และจบด้วย `ROLLBACK`
3. Deploy Lambda ที่มีตัวกรองตำแหน่งจริงใน API เดิม **ก่อน commit ข้อมูลจริง** โดยรักษา environment, IAM และ network เดิม จากนั้นตรวจ health, public regression และ anonymous `/api/v3/me` ได้ 401
4. รัน SQL เดิมด้วย `apply=true` เมื่อตรวจ checksum และผล dry run ผ่านแล้ว SQL เพิ่ม migration 003 และข้อมูลใน transaction เดียว ตรวจประวัติ migration 001/002/003, collision และ fingerprint ของข้อมูลผู้ใช้/แผน 10 ตาราง หากไม่ตรงจะไม่ commit
5. ตรวจรายชื่อผ่าน API และทดสอบรายละเอียดด้วยทั้งสาม role แล้วจึง merge/deploy frontend ไม่ต้องสั่ง build ซ้ำหาก Amplify กำลังทำงาน
6. ตรวจหน้าแรก Directory การเลือกบริษัท/ตำแหน่งในแผน การ Logout และแท็บอื่นอีกครั้งบน main การทดสอบในเครื่องไม่ใช่ผลตรวจรับระบบที่ deploy

ตัวอย่างคำสั่ง SQL เมื่อไฟล์กับ CA อยู่ใน CloudShell แล้ว:

```bash
psql "host=coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com port=5432 dbname=coed user=postgres sslmode=verify-full sslrootcert=$PWD/global-bundle.pem connect_timeout=10" \
  -X -W -v ON_ERROR_STOP=1 -v apply=false -f partner-import.sql
```

เปลี่ยนเป็น `apply=true` เฉพาะขั้นตอน 4 ค่า `apply` ไม่ใช่สิทธิ์ข้ามการตรวจ target/checksum หากมีข้อผิดพลาดหรือผลไม่ตรง หยุดตรวจสาเหตุ ไม่ลบข้อมูลหรือ reset เพื่อรันใหม่

## การทดสอบและการกู้กลับ

`npm test` มีการทดสอบ API permission, หน้าเว็บและการนำเข้าใน PostgreSQL ทดสอบที่แยกจาก production รวมถึง dry run, idempotency และ rollback เมื่อชน ID เดิม ใช้ `npm run test:directory-db` แยกได้ โดยต้องตั้ง `NODE_ENV=test`, `ALLOW_DB_RESET=true` และ `TEST_DATABASE_URL` ของฐานข้อมูลทดสอบบน loopback

ห้ามย้อนกลับไปใช้ Lambda เก่าที่เปิดทุกตำแหน่งเป็น public หลังนำเข้าข้อมูลจริงแล้ว หากต้องถอย frontend ให้คง backend ที่ปิดข้อมูลตำแหน่งจริงไว้ การลบ migration หรือข้อมูลนำเข้าอาจกระทบแผนใหม่ที่เริ่มอ้างอิงบริษัทเหล่านี้ ต้องตรวจ foreign key และ snapshot ก่อนวางแผนกู้กลับ

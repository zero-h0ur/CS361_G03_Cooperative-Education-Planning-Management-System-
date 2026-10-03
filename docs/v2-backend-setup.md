# การติดตั้งและทดสอบ Backend CO-ED V2

เอกสารนี้อธิบายขั้นตอนการตั้งค่า Local PostgreSQL Database, การรัน Migrations และ Seed ข้อมูล รวมถึงการทดสอบ Data Access Layer ของ V2

## 1. สิ่งที่ต้องมีเบื้องต้น (Prerequisites)
- [Node.js](https://nodejs.org/) เวอร์ชัน 18.14 ขึ้นไป
- [Docker](https://www.docker.com/) (สำหรับรัน Local PostgreSQL)

## 2. เริ่มต้น Local PostgreSQL Database
ใช้คำสั่งต่อไปนี้เพื่อรัน PostgreSQL 16 ภายในคอนเทนเนอร์:
```bash
docker run --name pg-v2 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=coed_v2 -p 5432:5432 -d postgres:16-alpine
```

สร้าง Database แยกสำหรับ Automated tests:

```bash
docker exec pg-v2 psql -U postgres -c "CREATE DATABASE coed_v2_test;"
```

## 3. ติดตั้ง Dependencies
```bash
npm ci
```

## 4. การตั้งค่า Environment
คัดลอกไฟล์ Environment ต้นแบบ:
```bash
cp .env.example .env
```
ตรวจสอบให้แน่ใจว่า:

- `DATABASE_URL` ชี้ไปที่ `coed_v2`
- `TEST_DATABASE_URL` ชี้ไปที่ `coed_v2_test`
- `ALLOW_DB_RESET=false` เป็นค่าเริ่มต้น
- ห้ามกำหนด `TEST_DATABASE_URL` ให้เหมือนกับ `DATABASE_URL`

## 5. รัน Migration และ Seed ข้อมูล
สคริปต์ Seed จะตรวจสอบ Environment Variables เพื่อความปลอดภัย จากนั้นจะจัดการรัน Migration เพื่อสร้างโครงสร้างตารางและนำเข้าข้อมูลตัวอย่าง (Mock Dataset) โดยอัตโนมัติ

**คำเตือน**: อย่ารันคำสั่งนี้กับ Production Database เนื่องจากจะเป็นการลบและเขียนข้อมูลทับใหม่ทั้งหมด
```bash
NODE_ENV=development ALLOW_DB_RESET=true npm run seed
```
ตัวอย่างผลลัพธ์ที่ควรจะได้:
```text
Starting seed process...
Running migrations...
Applying migration: 001_initial_schema.sql
Migrations applied successfully.
Loading dataset...
Resetting tables...
Seeding companies...
...
Seed process completed successfully. Total records: 53
```

## 6. รัน Automated Tests
คำสั่งนี้จะรันทั้ง Dataset validation tests จาก #29 ด้วย Node test runner และ Data Access Layer integration tests ด้วย Jest

*หมายเหตุ: Test จะปฏิเสธการทำงานหากไม่มี `TEST_DATABASE_URL` หรือหาก Test database มีค่าเหมือน Development database*
```bash
ALLOW_DB_RESET=true npm test
```

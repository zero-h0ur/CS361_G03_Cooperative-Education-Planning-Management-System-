# การติดตั้งและทดสอบ Backend CO-ED V2

เอกสารนี้อธิบายขั้นตอนการตั้งค่า Local PostgreSQL Database, การรัน Migrations และ Seed ข้อมูล รวมถึงการทดสอบ Data Access Layer ของ V2

## 1. สิ่งที่ต้องมีเบื้องต้น (Prerequisites)
- [Node.js](https://nodejs.org/) (แนะนำเวอร์ชัน 16 ขึ้นไป)
- [Docker](https://www.docker.com/) (สำหรับรัน Local PostgreSQL)

## 2. เริ่มต้น Local PostgreSQL Database
ใช้คำสั่งต่อไปนี้เพื่อรัน PostgreSQL 16 ภายในคอนเทนเนอร์:
```bash
docker run --name pg-v2 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=coed_v2 -p 5432:5432 -d postgres:16-alpine
```

## 3. ติดตั้ง Dependencies
```bash
npm install
```

## 4. การตั้งค่า Environment
คัดลอกไฟล์ Environment ต้นแบบ:
```bash
cp .env.example .env
```
ตรวจสอบให้แน่ใจว่าค่า `DATABASE_URL` ในไฟล์ `.env` ตรงกับ Local Docker ของคุณ (ค่าเริ่มต้นคือ `postgres://postgres:postgres@localhost:5432/coed_v2`)

## 5. รัน Migration และ Seed ข้อมูล
สคริปต์ Seed จะตรวจสอบ Environment Variables เพื่อความปลอดภัย จากนั้นจะจัดการรัน Migration เพื่อสร้างโครงสร้างตารางและนำเข้าข้อมูลตัวอย่าง (Mock Dataset) โดยอัตโนมัติ

**คำเตือน**: อย่ารันคำสั่งนี้กับ Production Database เนื่องจากจะเป็นการลบและเขียนข้อมูลทับใหม่ทั้งหมด
```bash
node src/db/seed.js
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
ชุดการทดสอบจะครอบคลุมการทำงานของ Data Access Layer, Data constraints, Relationships, และ Database persistence

*หมายเหตุ: เพื่อให้ Test รันผ่านอย่างสมบูรณ์ กรุณาตรวจสอบว่า Database รันอยู่และเตรียม Test Database แยกต่างหากตามที่แนะนำใน `.env.example`*
```bash
npm test
```

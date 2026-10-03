# Decisions After Implementation: Issue 30

## Decision Status: Pending team review

### PostgreSQL driver และ Migration approach
- **Driver**: ใช้ `pg` module ของ Node.js พร้อมกับการจัดการ Connection Pool
- **Migration approach**: สร้างตาราง `schema_migrations` เพื่อติดตามไฟล์ SQL ที่ถูกรันแล้วในโฟลเดอร์ `src/db/migrations` โดยแยกระบบ Migration ออกจากโค้ด Seed และเรียกใช้งานผ่าน `src/db/migrate.js`

### Environment variable names
- `DATABASE_URL`: Connection string สำหรับ Development หรือ Runtime
- `TEST_DATABASE_URL`: Connection string สำหรับ Automated tests ซึ่งต้องไม่ซ้ำกับ `DATABASE_URL`
- `DB_POOL_MAX`: จำนวน Connection สูงสุดใน Pool (ค่าเริ่มต้นคือ 10)
- `DB_IDLE_TIMEOUT`: ระยะเวลา (มิลลิวินาที) ที่ Connection สามารถอยู่ในสถานะว่างก่อนจะถูกตัด (ค่าเริ่มต้นคือ 30000)
- `DB_CONN_TIMEOUT`: ระยะเวลาสูงสุดในการรอเชื่อมต่อ (ค่าเริ่มต้นคือ 2000)
- `DB_QUERY_TIMEOUT`: ระยะเวลาสูงสุดในการรอ Query (ค่าเริ่มต้นคือ 5000)
- `NODE_ENV` และ `ALLOW_DB_RESET`: Flag สำหรับความปลอดภัย โดย `ALLOW_DB_RESET` มีค่าเริ่มต้นเป็น `false`

### Connection pool และ Query timeout
- จำกัดขนาด Pool ไว้ที่ 10 เพื่อป้องกันปัญหา Resource exhaustion
- ค่า Timeout ต่างๆ (รวมถึง Query timeout) สามารถกำหนดผ่าน Environment variable ได้ แต่มีค่าเริ่มต้นที่เหมาะสมเพื่อให้ระบบ Fail-fast หาก Database ช้าหรือไม่สามารถเชื่อมต่อได้

### Page size Default/Maximum
- **Default Page Size**: 10
- **Maximum Page Size**: 100
- **Validation**: มีการตรวจสอบค่าให้เป็นจำนวนเต็มบวกอย่างเคร่งครัด (Strict positive integer) ป้องกันไม่ให้ค่าอย่าง `1abc` หรือตัวเลขทศนิยมทำให้ระบบทำงานผิดพลาด

### Seed และ Reset commands
- คำสั่ง Seed (`src/db/seed.js`) จะทำการเรียก Migrator จากนั้นจะลบข้อมูลเดิมออกตามลำดับ Dependency และ Insert ข้อมูลใหม่จากไฟล์ `mock-dataset.json`
- **คำสั่ง**: `node src/db/seed.js`
- **ความปลอดภัย**: คำสั่งจะทำงานล้มเหลวทันทีหาก `NODE_ENV` ไม่ใช่ `development` หรือ `test` หรือไม่มี `ALLOW_DB_RESET=true` โดยใช้การโยน Error ให้ Test runner จับแทน `process.exit()`
- เมื่อ `NODE_ENV=test` ระบบบังคับใช้ `TEST_DATABASE_URL` และปฏิเสธการทำงานหากมีค่าเหมือน `DATABASE_URL`

### Error types
- `DALError`: Error พื้นฐานสำหรับปัญหาเกี่ยวกับ Database (เช่น ปัญหาการเชื่อมต่อ, Constraint Violation หรือ Query ล้มเหลว) โดยมีการแปลงรหัส Constraint ให้เข้าใจง่าย (เช่น `23502` -> Required field is missing)
- `RecordNotFoundError`: ใช้เมื่อค้นหา ID ไม่พบ
- `InvalidInputError`: ใช้เมื่อส่งค่า Pagination ไม่ถูกต้อง, ขาด Parameter ที่จำเป็น หรือรูปแบบ UUID ไม่ถูกต้อง โดยจะไม่ส่ง Raw SQL error message ออกไปให้ฝั่ง Caller เห็น

### Test results
- Local verification วันที่ 4 ตุลาคม 2026:
  - `npm ci` ผ่าน
  - Dependency audit ผ่านโดยพบ `0 vulnerabilities`
  - Dataset validation tests ผ่าน `15/15`
  - Data Access Layer integration tests ผ่าน `21/21`
- มี Automated tests ด้วย Jest (`tests/dal.test.js`) ครอบคลุม:
  - การบันทึกและรัน Migration (`schema_migrations`) และการ Insert ข้อมูล 53 Records
  - การตรวจสอบและบังคับใช้ Foreign key และ Check constraints
  - การโยน Error เมื่อได้รับข้อมูลไม่ถูกต้อง (เช่น UUID ผิดรูปแบบ) หรือไม่พบ Record
  - ข้อบังคับการดึงข้อมูล Public ที่กรองข้อมูล Private ออกอย่างเข้มงวด และตรวจสอบว่า Position แบบ Public ต้องมาจาก Company ที่เป็น Public ด้วยเท่านั้น
  - การทดสอบ Persistence ยืนยันจำนวน Record และความสัมพันธ์หลังปิดและเปิด Connection

### Persistence evidence
- ชุดทดสอบบันทึก Record counts และจำนวน Plan ที่เชื่อมกับ Student/Round ก่อนสั่ง `close()` จากนั้นเปิด Connection pool ใหม่และเปรียบเทียบค่าหลังเชื่อมต่ออีกครั้ง
- หลังเปิด Connection ใหม่ยังพบข้อมูลครบ 53 Records และ Student–Plan/Round relationships จำนวน 7 รายการเท่าเดิม
- Persistence test ผ่านในการรัน Local PostgreSQL 16 แยก Test database

### Trade-offs หรือข้อจำกัดที่เหลืออยู่
- การค้นหาแบบ Partial search ช่วงเริ่มต้นใช้ `ILIKE` แทนการทำ Full-text indexing หรือใช้ `pg_trgm` เนื่องจากขนาดข้อมูล Mock ยังไม่ใหญ่มาก ตามข้อตกลงใน Issue 28 โดยจะนำกลับมาพิจารณาอีกครั้งเมื่อพบปัญหาด้านประสิทธิภาพ
- การดึงข้อมูล Position พร้อม Company ใน AP2 (Search) ยังอาศัย 2 Queries และ Aggregate ใน Data Access Layer แทนที่จะ Join ทันที

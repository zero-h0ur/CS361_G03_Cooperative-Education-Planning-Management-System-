# Issue #32 Company Directory verification

เอกสารนี้บันทึกวิธีเปิด Frontend และ V2 Public API ภายใต้ Origin เดียวกัน รวมถึงรายการตรวจสอบด้วย Browser ก่อนปิด Issue #32

## Automated verification

รันจาก Root ของ Repository:

```bash
npm ci
npm run test:dataset
npm run test:api
npm run test:frontend
node --check company-directory.js
git diff --check main...HEAD
```

Frontend tests ครอบคลุม Query parameters, การ Reset หน้าเมื่อ Search/Filter เปลี่ยน, การรวมข้อมูลโดยไม่สร้าง Company ซ้ำ, Stale response, Static fallback, Safe text rendering, Data-status indicator และสถานะ Load More ระหว่างโหลด

## เปิด Frontend และ API ภายใต้ Origin เดียวกัน

1. เตรียม PostgreSQL และ `.env` ตาม [V2 Backend Setup](v2-backend-setup.md)
2. Seed ข้อมูล Development ตามคำสั่งในเอกสาร Backend Setup
3. เปิด API ที่ Port `3000`:

   ```bash
   npm start
   ```

4. เปิด Static frontend ผ่าน Reverse proxy อีก Terminal หนึ่ง:

   ```bash
   npx http-server . -a 127.0.0.1 -p 8080 -P http://127.0.0.1:3000 -c-1
   ```

5. เปิดหน้า:

   ```text
   http://127.0.0.1:8080/company-directory.html
   ```

ห้ามเปิด Frontend จาก Server ที่ไม่ Proxy `/api` ไปยัง Port `3000` เพราะ Request แบบ Relative path จะได้ `404` และระบบจะเข้า Static fallback

## Manual verification checklist

บันทึก Browser, Viewport, ผลลัพธ์ และ Screenshot/Console evidence ใน PR ก่อนติ๊กแต่ละรายการ

- [ ] Initial API load แสดง Dynamic company cards โดยไม่มี Offline banner
- [ ] Search ด้วยชื่อบริษัทภาษาไทยและภาษาอังกฤษ
- [ ] Search ด้วยชื่อตำแหน่งภาษาไทยและภาษาอังกฤษ
- [ ] Filter ครบทั้ง กรุงเทพฯ, ชลบุรี, นนทบุรี, ปทุมธานี, ระยอง และเชียงใหม่
- [ ] Search และ Location filter ทำงานร่วมกัน
- [ ] No-result แสดงข้อความว่าไม่พบข้อมูลและซ่อนปุ่ม “ดูเพิ่มเติม”
- [ ] “ดูเพิ่มเติม” ปิดการกดซ้ำระหว่างโหลด, Append หน้าถัดไป และไม่สร้าง Company ซ้ำ
- [ ] เมื่อ API ไม่พร้อม ระบบแสดง Static cards, Offline banner และ Static search ยังใช้งานได้
- [ ] Static fallback ซ่อนและ Disable Location filter
- [ ] Keyboard สามารถใช้งาน Search, Location filter และปุ่ม “ดูเพิ่มเติม” ได้
- [ ] Layout ไม่มี Horizontal overflow ที่ Mobile, Tablet และ Desktop
- [ ] Dynamic card ไม่เสีย Layout เมื่อไม่มี Logo หรือมีข้อความยาว
- [ ] Browser Console ไม่มี Unexpected error

## Evidence status

- Automated verification: บันทึกผลจากคำสั่งด้านบนใน PR
- Manual Browser verification: ต้องดำเนินการและแนบหลักฐานก่อนติ๊ก `Manual verification evidence` ใน Issue #32

# Contributing Guidelines

เอกสารนี้กำหนดรูปแบบการทำงานร่วมกันใน Repository เพื่อให้สมาชิกทีมสร้าง Branch, Commit และ Pull Request ในแนวทางเดียวกัน

## Branch Workflow

1. อัปเดต `main` ให้เป็นเวอร์ชันล่าสุดก่อนเริ่มงาน

   ```bash
   git switch main
   git pull origin main
   ```

2. สร้าง Branch ใหม่สำหรับงานของตนเอง

   ```bash
   git switch -c <branch-name>
   ```

3. แก้ไขและทดสอบงานใน Branch ของตนเอง
4. Commit และ Push Branch ขึ้น GitHub
5. เปิด Pull Request เพื่อขอรวมงานเข้า `main`
6. ให้สมาชิกทีมอย่างน้อย 1 คน Review และ Approve
7. แก้ไขข้อเสนอแนะและ Resolve conversations ให้ครบก่อน Merge

ห้าม Push งานลง `main` โดยตรง

## Branch Naming

ใช้รูปแบบต่อไปนี้:

```text
feature/<issue-number>-<short-description>
fix/<issue-number>-<short-description>
docs/<issue-number>-<short-description>
chore/<short-description>
```

| Prefix | ใช้สำหรับ | ตัวอย่าง |
| --- | --- | --- |
| `feature/` | เพิ่มความสามารถใหม่ | `feature/13-requirements-page` |
| `fix/` | แก้ไขข้อผิดพลาด | `fix/14-faq-search` |
| `docs/` | แก้ไขเอกสารเท่านั้น | `docs/15-update-readme` |
| `chore/` | ตั้งค่า Repository หรือเครื่องมือ | `chore/repository-workflow` |

กติกาการตั้งชื่อ Branch:

- ใช้ภาษาอังกฤษตัวพิมพ์เล็ก
- ใช้ `-` แทนช่องว่าง
- ถ้างานมี Issue ให้ใส่หมายเลข Issue ในชื่อ Branch
- หนึ่ง Branch ควรรับผิดชอบหนึ่ง Issue หรือหนึ่งงานหลัก
- ตั้งชื่อให้สั้นและสื่อความหมาย

## Commit Messages

ใช้รูปแบบ:

```text
<type>: <short description>
```

ตัวอย่าง:

```text
feat: add requirements page
fix: correct company search
docs: update README
chore: configure repository workflow
```

ประเภท Commit ที่ใช้:

- `feat` สำหรับเพิ่มความสามารถใหม่
- `fix` สำหรับแก้ไขข้อผิดพลาด
- `docs` สำหรับแก้ไขเอกสาร
- `style` สำหรับแก้ไขรูปแบบที่ไม่เปลี่ยนการทำงาน
- `refactor` สำหรับปรับโครงสร้างโค้ดโดยไม่เพิ่มความสามารถใหม่
- `chore` สำหรับงานตั้งค่าและบำรุงรักษา Repository

แต่ละ Commit ควรมีการเปลี่ยนแปลงที่เกี่ยวข้องกันและอธิบายได้ชัดเจน

## Pull Requests

Pull Request ทุกอันควรมี:

- Summary อธิบายเป้าหมายของการเปลี่ยนแปลง
- หมายเลข Issue ที่เกี่ยวข้อง เช่น `Closes #13`
- รายการสิ่งที่เปลี่ยนแปลง
- ขั้นตอนและผลการทดสอบ
- ภาพหน้าจอสำหรับการเปลี่ยนแปลงหน้าเว็บ เมื่อเกี่ยวข้อง

ก่อน Merge ต้องตรวจสอบว่า:

- งานตรงตาม Acceptance Criteria ของ Issue
- ไม่มีไฟล์หรือการเปลี่ยนแปลงที่ไม่เกี่ยวข้อง
- มีสมาชิกทีมอย่างน้อย 1 คน Approve
- ข้อคิดเห็นในการ Review ถูกแก้ไขหรือ Resolve แล้ว

ผู้เปิด Pull Request ไม่ควรเป็นผู้ Approve งานของตนเอง

## Merge Strategy

ใช้ `Squash and merge` เพื่อรวมการเปลี่ยนแปลงของ Pull Request เป็น Commit เดียวบน `main`

หลัง Merge:

1. ลบ Branch ที่ทำงานเสร็จแล้วบน GitHub
2. กลับไปที่ `main` และดึงการเปลี่ยนแปลงล่าสุด

   ```bash
   git switch main
   git pull origin main
   ```

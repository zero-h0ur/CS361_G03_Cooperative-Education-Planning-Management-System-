# CO-ED: Cooperative Education Planning and Information System (Version 1)

CO-ED เป็นเว็บไซต์รวบรวมข้อมูลเบื้องต้นสำหรับนักศึกษาชั้นปีที่ 3 สาขาวิชาวิทยาการคอมพิวเตอร์ มหาวิทยาลัยธรรมศาสตร์ ที่กำลังเตรียมตัวเข้าร่วมสหกิจศึกษา โดยรวมข้อกำหนด ขั้นตอน กำหนดการ รายชื่อสถานประกอบการ และคำถามที่พบบ่อยไว้ในจุดเดียว

- เว็บไซต์ที่ Deploy แล้ว: [CO-ED บน AWS Amplify](https://main.d1d9qrqnsi5nl6.amplifyapp.com/)
- GitHub Repository: [zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-)

## Problem and Primary User

ข้อมูลที่ใช้เตรียมสหกิจศึกษาอยู่ในหลายแหล่ง เช่น ประกาศ เอกสาร และช่องทางสื่อสารของสาขาวิชา ทำให้นักศึกษาตรวจสอบข้อมูลและขั้นตอนที่ต้องดำเนินการได้ยาก ผู้ใช้หลักของ V1 จึงเป็นนักศึกษาชั้นปีที่ 3 ที่กำลังเตรียมสมัครเข้าแผนสหกิจศึกษาและต้องการดูข้อมูลสำคัญจากหน้าเว็บเดียว

## Project Vision

CO-ED มีเป้าหมายเป็นระบบกลางสำหรับวางแผนและจัดการสหกิจศึกษาของนักศึกษาอย่างครบวงจร เพื่อลดปัญหาข้อมูลที่กระจายอยู่ในแบบฟอร์ม ไฟล์ ตาราง และช่องทางสื่อสารหลายแห่ง รวมทั้งทำให้ข้อมูลสิทธิ์ สถานะ และช่วงเวลาของนักศึกษา สถานประกอบการ และผู้เกี่ยวข้องมีความสอดคล้องและตรวจสอบได้

เมื่อพัฒนาครบตามทิศทางของโจทย์ ระบบควรรองรับความสามารถหลักดังนี้:

- จัดการข้อมูลนักศึกษา สถานประกอบการ ตำแหน่งหรือโครงการ รอบเวลา และแผนสหกิจศึกษา
- ให้นักศึกษาสร้าง แก้ไข และส่งแผน รวมถึงเลือกหรือเสนอสถานประกอบการตามเงื่อนไขและช่วงเวลาที่กำหนด
- ให้อาจารย์และเจ้าหน้าที่ตรวจสอบ อนุมัติ ส่งกลับแก้ไข และติดตามความก้าวหน้าตามสิทธิ์
- ติดตามสถานะและ Deadline ตั้งแต่การเตรียมตัว การยื่นแผน การพิจารณา การสมัคร การตอบรับ การปฏิบัติงาน จนถึงเสร็จสิ้น
- ค้นหา กรอง สรุป และรายงานข้อมูลเพื่อสนับสนุนการวางแผนในระดับหลักสูตรหรือสาขาวิชา
- รองรับการนำเข้า แลกเปลี่ยน หรือส่งออกข้อมูลกับแหล่งข้อมูลอื่น โดยคำนึงถึงความถูกต้อง สิทธิ์ ความเป็นส่วนตัว และการตรวจสอบย้อนหลัง

ความสามารถเหล่านี้เป็น Vision ระยะยาวตามการพัฒนาตั้งแต่ V1 ถึง V7 ส่วน V1 ปัจจุบันรับผิดชอบเฉพาะการเผยแพร่ข้อมูลพื้นฐานที่จำเป็นต่อการเตรียมสหกิจศึกษา และยังไม่มี Dynamic Data, Authentication, Workflow หรือการติดตามสถานะรายบุคคล

## Smallest Useful V1

V1 ช่วยให้ผู้ใช้ดำเนินตาม Core User Path ต่อไปนี้ได้:

1. เปิดหน้าแรกเพื่อดูภาพรวมและข้อมูลสำคัญ
2. ตรวจสอบคุณสมบัติและข้อกำหนดของสหกิจศึกษา
3. อ่านภาพรวมขั้นตอนและเอกสารที่ต้องเตรียม
4. เรียกดูและค้นหารายชื่อสถานประกอบการ
5. ค้นหาคำถามที่พบบ่อยเกี่ยวกับการสมัครและการเตรียมตัว

## Implemented Features

| Feature | รายละเอียด | ไฟล์หลัก |
| --- | --- | --- |
| Landing page | แสดงภาพรวม ประกาศ กำหนดการ และตัวอย่างสถานประกอบการ | `index.html` |
| Requirements | แสดงคุณสมบัติ ข้อกำหนด ขั้นตอน เอกสาร และแนวทางเตรียมตัว | `requirements.html` |
| Company directory | แสดง ค้นหา และโหลดรายชื่อสถานประกอบการเพิ่มเติม | `company-directory.html`, `company-directory.js` |
| FAQ | แสดงและค้นหาคำถามที่พบบ่อย พร้อมล้างคำค้นหา | `faq.html` |
| Responsive layout | รองรับการใช้งานบน Desktop, Tablet และ Mobile | `style.css` |
| Deployment | Deploy จาก Branch `main` ผ่าน AWS Amplify Hosting | AWS Amplify, GitHub |

## V1 System Boundary

### Inside V1

- แสดงข้อมูลเบื้องต้นเกี่ยวกับสหกิจศึกษา
- แสดงเกณฑ์ คุณสมบัติ ขั้นตอน และแนวทางเตรียมตัว
- แสดงข้อมูลเอกสารและกำหนดการที่ทีมรวบรวมไว้
- เรียกดูและค้นหารายชื่อสถานประกอบการ
- แสดงและค้นหาคำถามที่พบบ่อย
- รองรับการเปิดเว็บไซต์ผ่าน HTTPS บน AWS Amplify

### Outside V1

- ระบบสมัครสมาชิกและเข้าสู่ระบบที่ทำงานจริง
- การจัดเก็บข้อมูลส่วนบุคคลของนักศึกษา
- การยื่นใบสมัครหรืออัปโหลดเอกสาร
- การอนุมัติแผนและติดตามสถานะรายบุคคล
- ระบบหลังบ้านสำหรับอาจารย์หรือเจ้าหน้าที่
- Backend, API, Database และการเชื่อมต่อข้อมูลแบบ Real-time

## Actors and Data Sources

| ประเภท | รายละเอียด |
| --- | --- |
| Primary actor | นักศึกษาชั้นปีที่ 3 ที่กำลังเตรียมสมัครเข้าแผนสหกิจศึกษา |
| Information providers | สาขาวิชา อาจารย์หรือเจ้าหน้าที่ผู้รับผิดชอบ และสถานประกอบการ |
| University sources | เว็บไซต์สาขาวิชา รายละเอียดหลักสูตร ประกาศ และแบบฟอร์มของมหาวิทยาลัย |
| Company sources | ข้อมูลสาธารณะของสถานประกอบการ |
| V1 data format | เนื้อหา Static ภายใน HTML และ JavaScript ซึ่งแก้ไขผ่าน Git workflow |

## Current Architecture

> เพิ่ม Architecture Diagram ที่แสดงเฉพาะ Component ซึ่งใช้งานจริงใน Version 1 ที่นี่

### Components

| Component | Service / Technology | Responsibility |
| --- | --- | --- |
| Client | _ระบุภายหลัง_ | _ระบุภายหลัง_ |
| Hosting | _ระบุภายหลัง_ | _ระบุภายหลัง_ |
| Source and Deployment | _ระบุภายหลัง_ | _ระบุภายหลัง_ |
| Data and External Sources | _ระบุภายหลัง_ | _ระบุภายหลัง_ |

### Data Flow

1. _ระบุ Request Flow จากผู้ใช้เข้าสู่ระบบ_
2. _ระบุการส่งและประมวลผลข้อมูลภายในระบบ_
3. _ระบุ Deployment Flow จาก Source code ไปยังระบบที่ให้บริการ_

## Design Decision and Trade-off

ทีมเลือกพัฒนา V1 เป็น Static Website เพราะ Requirement ของ Version นี้เน้นการเผยแพร่ข้อมูลพื้นฐาน และยังไม่มีการบันทึกข้อมูลผู้ใช้หรือธุรกรรมที่จำเป็นต้องมี Backend โดยเปรียบเทียบการ Hosting ระหว่าง Amazon S3 และ AWS Amplify Hosting ก่อนเลือกใช้ Amplify

| ประเด็น | AWS Amplify Hosting | Amazon S3 |
| --- | --- | --- |
| Deployment | เชื่อม GitHub และ Deploy อัตโนมัติเมื่อมีการเปลี่ยนแปลงบน Branch `main` | ต้องอัปโหลดหรือ Sync ไฟล์เอง หรือสร้าง GitHub Actions สำหรับการ Deploy |
| HTTPS และ CDN | มี HTTPS และ CDN ซึ่งทำงานบน Amazon CloudFront ให้พร้อมใช้งาน | S3 Website Endpoint รองรับ HTTP และไม่มี CDN มาให้ในตัว |
| การตั้งค่าและดูแล | ตั้งค่าน้อยและติดตามผลการ Deploy ได้จากหน้าเดียว | ต้องตั้งค่า Bucket, Static website hosting, สิทธิ์การเข้าถึง และขั้นตอน Deploy |
| ค่าใช้จ่าย | คิดตามเวลา Build, พื้นที่จัดเก็บ และการส่งข้อมูล | คิดตามพื้นที่จัดเก็บ จำนวน Request และการส่งข้อมูล |
| ความเหมาะสม | เหมาะกับทีมที่ต้องการนำโค้ดจาก GitHub ขึ้นเว็บอย่างรวดเร็ว | เหมาะกับเว็บ Static ที่ต้องการควบคุมการจัดเก็บไฟล์และขั้นตอน Deploy เอง |

สำหรับเว็บไซต์ V1 ที่มีขนาดเล็ก ค่าใช้จ่ายของทั้งสองทางเลือกอยู่ตามปริมาณการใช้งาน ทีมยอมรับค่า Build ที่อาจเกิดขึ้นกับ Amplify เพื่อแลกกับการ Deploy จาก GitHub, HTTPS และ CDN ที่พร้อมใช้งาน ส่วน S3 อาจประหยัดกว่าเมื่อเก็บไฟล์ Static เพียงอย่างเดียว แต่ทีมต้องจัดการขั้นตอน Deploy และการให้บริการเว็บเพิ่มเติมเอง

ทีมจึงเลือก Amplify เพราะเหมาะกับ Workflow ที่ Merge โค้ดเข้า `main` แล้ว Deploy อัตโนมัติ ทำให้ตรวจสอบ Version ที่นำขึ้นใช้งานได้ง่าย Trade-off คือมีค่า Build ทุกครั้งที่ Deploy และควบคุมรายละเอียดของ Hosting ได้น้อยกว่าการตั้งค่าบน S3 ด้วยตนเอง

แหล่งอ้างอิงสำหรับการตัดสินใจ:

- [AWS Amplify Pricing](https://aws.amazon.com/amplify/pricing/)
- [AWS Amplify Hosting และ Continuous Deployment](https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html)
- [Amazon S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [Amazon S3 Website Endpoints และข้อจำกัด HTTPS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)

## Technology Stack

- HTML5
- CSS3
- Vanilla JavaScript
- Font Awesome ผ่าน CDN
- Git และ GitHub สำหรับ Issue, Branch, Commit, Pull Request และ Review
- AWS Amplify Hosting สำหรับ HTTPS และ Deployment

## Project Structure

```text
.
├── index.html                 # หน้าแรก
├── requirements.html          # คุณสมบัติ ข้อกำหนด ขั้นตอน และเอกสาร
├── company-directory.html     # หน้ารายชื่อสถานประกอบการ
├── company-directory.js       # การค้นหาและโหลดรายการเพิ่มเติม
├── faq.html                   # คำถามที่พบบ่อยและการค้นหา
├── style.css                  # รูปแบบและ Responsive layout
├── resources/images/          # รูปภาพและโลโก้ที่ใช้ในเว็บไซต์
├── CONTRIBUTING.md            # Branch, Commit, PR และ Merge workflow
└── README.md
```

## Run Locally

### วิธีที่ 1: เปิดไฟล์โดยตรง

Clone Repository แล้วเปิด `index.html` ด้วย Browser

```bash
git clone https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-.git
cd CS361_G03_Cooperative-Education-Planning-Management-System-
open index.html
```

บน Windows สามารถใช้ `start index.html` แทนคำสั่ง `open index.html`

### วิธีที่ 2: เปิดผ่าน Local Server

```bash
python3 -m http.server 8000
```

จากนั้นเปิด [http://localhost:8000](http://localhost:8000) และหยุด Server ด้วย `Ctrl + C`

## Verification Checklist

1. เปิดหน้าแรกและตรวจว่า Navigation ไปยังทุกหน้าได้
2. เปิดหน้า Requirements และตรวจสอบการแสดงคุณสมบัติ ขั้นตอน และเอกสาร
3. เปิดหน้า Company Directory แล้วค้นหาชื่อบริษัททั้งกรณีที่พบและไม่พบ
4. กดปุ่มโหลดรายการเพิ่มเติมในหน้า Company Directory
5. เปิดหน้า FAQ แล้วค้นหาคำถามและทดลองล้างคำค้นหา
6. ตรวจหน้าเว็บที่ความกว้าง Mobile, Tablet และ Desktop
7. ตรวจ Deployment หลัง Merge เข้า `main`

## Assumptions and Information to Validate

ข้อมูลบางส่วนอาจเปลี่ยนแปลงตามปีการศึกษาและประกาศของสาขาวิชา จึงต้องตรวจสอบก่อนนำไปใช้จริง

| ข้อมูล | สถานะ |
| --- | --- |
| กำหนดการและวันสำคัญ | `TO VALIDATE` กับประกาศของปีการศึกษาปัจจุบัน |
| รายการเอกสารและช่องทางส่ง | `TO VALIDATE` กับแบบฟอร์มและประกาศล่าสุด |
| สถานะการเปิดรับของสถานประกอบการ | `TO VALIDATE` กับสาขาวิชาและสถานประกอบการ |
| ตำแหน่ง สถานที่ และค่าตอบแทน | `TO VALIDATE` จากประกาศของสถานประกอบการ |
| เงื่อนไขการสมัครที่อาจเปลี่ยนรายปี | `TO VALIDATE` กับผู้รับผิดชอบโครงการ |

## Engineering Evidence

### Issues

- [#3 Define Project and V1 Direction](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/3)
- [#5 Define V1 System Boundary](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/5)
- [#6 Prepare and Validate V1 Public Information](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/6)
- [#7 Implement V1 Landing Page](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/7)
- [#8 Display and Search Company Information](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/8)
- [#9 Display Frequently Asked Questions](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/9)
- [#10 Display Cooperative Education Requirements and Guidelines](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/10)
- [#11 Complete V1 README](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/11)

### Pull Requests and Reviews

- [#12 Repository workflow](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/12)
- [#13 Requirements page](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/13)
- [#14 Company names and logos](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/14)
- [#15 Mobile navigation](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/15)
- [#16 FAQ reference content](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/16)
- [#17 FAQ search](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/17)
- [#18 Eligibility criteria](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/18)
- [#19 Responsive layout](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/19)
- [#20 Company search layout](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/20)
- [#21 Company directory code comments](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/21)

### Screenshot Evidence

ภาพตัวอย่างหน้าเกณฑ์รับสมัครจาก Pull Request #18:

![หน้าเกณฑ์รับสมัครสหกิจศึกษา](https://github.com/user-attachments/assets/db8b15e8-f821-4e00-9764-cb520a61b3a7)

## Sources

- [เว็บไซต์สาขาวิชาวิทยาการคอมพิวเตอร์ มหาวิทยาลัยธรรมศาสตร์](https://cs.sci.tu.ac.th/)
- [ข้อมูลหลักสูตรวิทยาการคอมพิวเตอร์](https://cs.sci.tu.ac.th/comsci-ac-th-2/)
- [แบบฟอร์มงานวิชาการและกิจการนักศึกษา](https://cs.sci.tu.ac.th/academic-scitu-th/)
- [ช่องทางติดต่อสาขาวิชา](https://cs.sci.tu.ac.th/contact-th-2/)
- [รายละเอียดหลักสูตรจากสำนักทะเบียน มหาวิทยาลัยธรรมศาสตร์](https://web2.reg.tu.ac.th/th/Picture/AttFile/699889be-7baf-4d2b-8066-69807be2f296)

## Team Members

- Paponpat Meevon
- Purinat Wanthanathanya
- รณกฤต วรลักษณ์ภักดี
- Nustapark Krai

## Contribution Workflow

รูปแบบ Branch, Commit, Pull Request, Review และ Merge ระบุไว้ใน [CONTRIBUTING.md](CONTRIBUTING.md)

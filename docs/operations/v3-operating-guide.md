# คู่มือพัฒนาและดูแล V3

เอกสารนี้รวมวิธีรัน ทดสอบ ติดตั้ง และดูแลระบบสำหรับทีมที่จะพัฒนาต่อ รายละเอียดโครงสร้างและ API อยู่ใน [Architecture](../architecture/G03-V3-architecture.md) และ [API contract](../api/v3-shared-contract.md) ส่วนผลทดสอบที่ผ่านมาอยู่ใน [สรุปส่งมอบ](../evidence/v3-delivery-index.md)

ตัวอย่างคำสั่งใช้ Bash จาก root ของ repo ส่วนคำสั่ง AWS ใช้ session ที่มีสิทธิ์ของผู้ดูแล ตรวจ environment และสำรองข้อมูลก่อนเปลี่ยนระบบจริง

## รันในเครื่อง

ใช้ Node.js 20+, npm และ Docker สำหรับ PostgreSQL:

```bash
npm ci
npm run dev:ui
```

UI preview อยู่ที่ `http://localhost:8081/app.html#/student/plan` ใช้ข้อมูลใน memory ไม่เชื่อม AWS/DB และไม่ทดสอบ authentication จริง ดู [Local UI Preview](../frontend/local-ui-preview.md)

### ฐานข้อมูล development และ test

ตรวจว่าชื่อ container และพอร์ตยังว่างก่อนสร้าง ใช้รหัสผ่านเฉพาะเครื่อง ห้ามใช้รหัสเดียวกับ RDS:

```bash
docker ps -a --filter name=coed-v3-local
read -r -s -p 'New LOCAL PostgreSQL password: ' POSTGRES_PASSWORD
printf '\n'
export POSTGRES_PASSWORD
docker run --name coed-v3-local \
  --env POSTGRES_PASSWORD --env POSTGRES_DB=coed_v3_dev \
  --publish 127.0.0.1:55432:5432 \
  --volume coed-v3-local-data:/var/lib/postgresql/data \
  --detach postgres:16-alpine
unset POSTGRES_PASSWORD
docker exec coed-v3-local pg_isready -U postgres -d coed_v3_dev
```

เมื่อฐานข้อมูลพร้อม จึงสร้าง test DB แล้วคัดลอกตัวอย่าง config หากยังไม่มี `.env`:

```bash
docker exec coed-v3-local psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c 'CREATE DATABASE coed_v3_test;'
cp -n .env.example .env
```

แก้ค่าต่อไปนี้ใน `.env` โดยแทน placeholder ด้วยรหัส local ที่ URL-encode แล้ว:

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-local-password>@127.0.0.1:55432/coed_v3_dev
TEST_DATABASE_URL=postgresql://postgres:<url-encoded-local-password>@127.0.0.1:55432/coed_v3_test
NODE_ENV=development
ALLOW_DB_RESET=false
PORT=3000
```

`.env` และ Docker metadata อาจมีรหัส local จึงไม่ควรเผยแพร่ ใช้ฐานข้อมูล development/test คนละตัว และไม่ตั้งค่าทั้งสองให้ชี้ RDS

```bash
NODE_ENV=development npm run migrate
npm start
```

Local public API อยู่ที่ `http://localhost:3000/api/companies` ส่วน protected API ต้องใช้ข้อมูลยืนยันตัวตนจาก API Gateway ตาม [auth contract](../api/v3-shared-contract.md) การรัน `npm start` เพียงอย่างเดียวจึงยังทดสอบ Login ไม่ได้ และไม่ได้เปิดให้ใช้ raw Bearer token แทน context ดังกล่าว

หากต้องการข้อมูลตัวอย่าง ใช้คำสั่งนี้เฉพาะฐานข้อมูล local ที่ยอมให้ล้างข้อมูลได้:

```bash
NODE_ENV=development ALLOW_DB_RESET=true npm run seed:v3
```

`seed:v3` reset ข้อมูลในฐานข้อมูลเป้าหมาย ไม่ใช้กับ RDS และไม่ได้สร้างบัญชี Cognito หยุด container ด้วย `docker stop coed-v3-local` โดย volume ยังเก็บข้อมูลอยู่

## ทดสอบ

```bash
NODE_ENV=test ALLOW_DB_RESET=true npm test
npm run test:frontend
npm run test:ui-preview
npm run test:docs
python3 -m unittest discover -s tests/operations -p 'test_*.py'
```

`npm test` เปลี่ยนข้อมูลใน test DB ต้องตรวจ `TEST_DATABASE_URL` ก่อนรัน ส่วน unit tests ของ scripts ดูแลระบบใช้ mocks หากต้องการทดสอบ scripts กับ PostgreSQL ให้ใช้ Docker ตามขั้นตอนใน CI

ผลในเครื่องไม่แทนการทดสอบ Cognito หรือสิทธิ์บนระบบจริง ขั้นตอนทดสอบระบบที่ deploy แล้วอยู่ใน [security smoke](v3-deployed-security-smoke.md)

## Configuration

### Frontend และ Cognito

`npm run build` ไม่โหลด `.env` อัตโนมัติ ต้อง export public values เหล่านี้จาก environment ที่จะทดสอบก่อน:

| Variable | ความหมาย |
| --- | --- |
| `CO_ED_API_BASE_URL` | API origin |
| `CO_ED_COGNITO_USER_POOL_ID` | User Pool ID |
| `CO_ED_COGNITO_CLIENT_ID` | Public app client ไม่มี client secret |
| `CO_ED_COGNITO_DOMAIN` | Cognito hostname ไม่มี scheme/path |
| `CO_ED_APP_ORIGIN` | Exact origin ของ frontend |

```bash
NODE_ENV=production CO_ED_REQUIRE_AUTH_CONFIG=1 npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Serve จาก `dist/` ไม่ใช่ source root ค่าข้างต้นเปิดเผยใน Browser ได้ แต่ห้ามใส่ DB credentials, AWS credentials หรือ client secret ลง frontend

Cognito ใช้ Code + PKCE S256, scopes `openid email coed-api/access` และเปิด token revocation โดยตั้ง callback เป็น `<origin>/app.html` และ sign-out เป็น `<origin>/index.html` แบบ exact URL ต้องอนุญาต origin ที่ serve อยู่จริงไว้ก่อน

Access/ID token มีอายุ 60 นาที ส่วน refresh token 480 นาที Protected routes ต้องใช้ Access Token และ scope `coed-api/access` ผ่าน API Gateway แล้ว backend ตรวจ active identity, role และ resource scope ใน RDS อีกครั้ง CORS ไม่ใช่การตรวจสิทธิ์

Logout ใช้ `signOut()` เพื่อ RevokeToken ของ session ปัจจุบันก่อนล้าง storage แล้วออกจาก Cognito Hosted UI แท็บอื่นใน origin เดียวกันล้าง session ตาม ไม่ใช่การออกจากทุกอุปกรณ์ รายละเอียดอยู่ใน [session/logout](../frontend/workspace-role-logout.md)

### Lambda, Secrets Manager และ RDS

| Setting | ค่าที่ต้องตรวจ |
| --- | --- |
| Runtime / handler | Node.js 22.x / `src/lambda.handler` |
| `AUTH_ISSUER` / `AUTH_AUDIENCE` | Cognito issuer และ public client ID ที่ตรงกับ Gateway |
| `DB_SECRET_ARN` | Full ARN ของ secret เดียว อ่าน `AWSCURRENT` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` | ต้องตรงกับ secret; runtime ใช้ `coed_app` |
| `DB_SSL_CA_FILE` | `/var/task/global-bundle.pem` พร้อมตรวจ certificate |
| `DB_CONN_TIMEOUT` / `DB_QUERY_TIMEOUT` / `DB_POOL_MAX` | Timeout และขนาด pool ที่ทบทวนแล้ว |

Secret JSON ต้องมี `engine=postgres`, `host`, `port`, `dbname`, `username` และ `password` Runtime cache รหัสไว้ใน memory ไม่เกิน 5 นาที หากอ่านหรือ validate ไม่ผ่านจะไม่ fallback ไป password URL การหมุนรหัสยังเป็นขั้นตอนดูแลระบบ ไม่ได้มี automatic rotation

RDS ไม่เปิด public access รับ TCP 5432 จาก Lambda security group ส่วน Secrets Manager ใช้ private interface endpoint TCP 443 จำกัดจาก Lambda SG บัญชี runtime ไม่ควรเป็น table owner หรือมี DDL/สิทธิ์จัดการ role

ตรวจ grants ได้จาก [v3-runtime-grants.sql](../../src/db/operations/v3-runtime-grants.sql) โดยใช้ผู้ดูแลฐานข้อมูล ไม่รันเป็น runtime user การเปลี่ยน grants ต้องทบทวนและอนุมัติก่อน

Lambda ที่ใช้งานอยู่ตั้งค่าเป็น secret reference ไม่มี `DATABASE_URL` หรือ `DB_PASSWORD` ใน environment สิทธิ์ที่ต้องใช้คือ `GetSecretValue` เฉพาะ ARN ที่กำหนด และ `kms:Decrypt` เฉพาะกรณีที่ key นั้นต้องการ

## Migration และ recovery

V3 ใช้ forward-only migrations พร้อม advisory lock และ checksum ฐานข้อมูลที่ตรวจรับแล้ว apply 002 และผ่าน read-only verification 13/13 ไม่ต้อง seed หรือ migrate ซ้ำ

สำหรับ environment ใหม่ ให้ตรวจ snapshot, migration source และสิทธิ์ของ migration account ก่อนรัน `npm run migrate` จาก network ที่เข้าถึงฐานข้อมูลได้ แยกบัญชีนี้จาก runtime `coed_app` Secret-mode runner ไม่รับ `postgres`/`rdsadmin` หากยังไม่มี migration account/config ที่เหมาะสมให้เตรียมกับผู้ดูแลก่อน ไม่เพิ่ม DDL ให้ runtime เพื่อแก้ปัญหา

ใช้ [verification SQL](../../src/db/verification/002_v3_forward_only_verification.sql) ตรวจฐานข้อมูลผ่าน TLS และ hidden password prompt:

```bash
psql 'host=coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com port=5432 dbname=coed user=postgres sslmode=verify-full sslrootcert=/absolute/private/path/global-bundle.pem connect_timeout=10' \
  -X -W -v ON_ERROR_STOP=1 -P pager=off \
  -f src/db/verification/002_v3_forward_only_verification.sql
```

ตรวจผล aggregate และ checksum เทียบ source ห้ามแก้ migration ที่ใช้แล้ว ปิด audit triggers หรือสร้าง tracking row เพื่อข้ามผลตรวจ อ่านขั้นตอนเมื่อ migration ล้มเหลวใน [migration recovery](../database/v3-migration-002-recovery.md)

## Deploy

Frontend merge เข้า `main` แล้ว Amplify build ตาม `amplify.yml` ใช้ `npm ci` และ strict production build ไม่ต้องเริ่ม job ซ้ำ ตรวจ job และ SHA ด้วย:

```bash
aws amplify list-jobs --region us-east-1 --app-id d1d9qrqnsi5nl6 \
  --branch-name main --max-results 3 \
  --query 'jobSummaries[].{Job:jobId,Status:status,Commit:commitId}' \
  --cli-connect-timeout 10 --cli-read-timeout 20 --no-cli-pager
```

ตรวจ `SUCCEED` พร้อม runtime config และ hosted JS/CSS ไม่ใช้ชื่อ branch หรือ metadata `HEAD` แทนการเทียบ source หากตั้ง environment ระดับ branch อย่าตั้ง `NODE_ENV=production` ก่อน `npm ci` เพราะ build tools อยู่ใน devDependencies

Backend deploy แยกจาก frontend และ migration รับ public CA จาก [RDS trust store](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) แล้ว package:

```bash
COED_RDS_CA_FILE=/absolute/path/to/trusted/global-bundle.pem npm run package:lambda
```

ตรวจ path/hash ของ ZIP ที่ packager คืนมา และเก็บ code/config รุ่นที่ใช้งานได้ไว้สำหรับ rollback ก่อน deploy หลังได้รับอนุมัติ ให้ตั้ง `COED_REVIEWED_ZIP` และ `COED_EXPECTED_ZIP_SHA256` เป็นไฟล์และค่า hash ที่ตรวจแล้ว:

```bash
(
set -euo pipefail
test -f "$COED_REVIEWED_ZIP"
printf '%s  %s\n' "$COED_EXPECTED_ZIP_SHA256" "$COED_REVIEWED_ZIP" | shasum -a 256 -c -
COED_DEPLOY_REVISION=$(aws lambda get-function-configuration \
  --region us-east-1 --function-name coed-api --query RevisionId --output text \
  --cli-connect-timeout 10 --cli-read-timeout 20 --no-cli-pager)
aws lambda update-function-code --region us-east-1 --function-name coed-api \
  --revision-id "$COED_DEPLOY_REVISION" --zip-file "fileb://$COED_REVIEWED_ZIP" \
  --query '{State:State,Update:LastUpdateStatus,CodeSHA:CodeSha256}' \
  --cli-connect-timeout 10 --cli-read-timeout 20 --no-cli-pager
)
```

หาก timeout หรือสถานะไม่คาดหมายให้ตรวจสถานะก่อน ไม่ retry write ทันที เมื่อ update สำเร็จต้องทดสอบ public 200, protected anonymous 401, exact CORS และ role/workflow ที่เกี่ยวข้อง การอัปโหลด code ไม่ได้ apply migration หรือเปลี่ยน config ให้

### Rollback

1. หยุด deployment เพิ่ม ระบุปัญหาและเลือก recovery target ที่ผ่านการทบทวน
2. Frontend ใช้ previous successful deployment พร้อม config และ callback/logout URL ที่เข้ากันได้ แล้วทดสอบ hosted assets และ Login ใหม่
3. Lambda มี secret-mode checkpoint version 3 จาก #82 ต้องตรวจ code/config และ API integration target ปัจจุบันก่อน restore การ publish version อย่างเดียวไม่สลับ API ที่เรียก `$LATEST`
4. ไม่ย้อนกลับไปใช้ master DB user หรือ password URL ที่อยู่ใน configuration เก่า
5. Schema ไม่ downgrade ถ้าต้องแก้ให้เพิ่ม forward-fix หรือ restore snapshot ไป instance ใหม่โดยประเมินข้อมูลที่จะสูญหายและแผน cutover ก่อน
6. หลัง recovery ทดสอบ role, persistence และ audit ใหม่ ขั้นตอนนี้ยังไม่ได้ซ้อม disaster recovery บนระบบจริง

## ตรวจอาการเบื้องต้น

| อาการ | จุดที่ควรตรวจ |
| --- | --- |
| `401` | Access Token, อายุ, scope, issuer และ client ID |
| `403` | Active identity, ownership, Advisor assignment และ Staff scope |
| `409` | โหลด version/state ล่าสุด; retry operation เดิมต้องใช้ idempotency key เดิม |
| `422` | State, รอบ OPEN, references และข้อมูลที่บังคับ |
| DB timeout | RDS available, network/SG/DNS และ TLS; `pg_isready` ยังไม่พิสูจน์ว่า Login ผ่าน |
| Secret error | ARN, AWSCURRENT, IAM/endpoint และ fields โดยไม่พิมพ์ secret |
| Logout | POST RevokeToken 200 แล้วตรวจ cross-tab และ Back/Refresh ไม่ใช้ redirect อย่างเดียวเป็นหลักฐาน |

CloudWatch group `/aws/lambda/coed-api` ตั้ง retention 30 วัน แยกจาก audit ใน RDS ไม่บันทึก token, password หรือข้อมูลนักศึกษาใน application logs การหยุด RDS ทำให้ส่วนที่อ่านฐานข้อมูลใช้ไม่ได้แม้หน้าเว็บยังเปิดได้ ต้องรอ `available` ก่อนทดสอบระบบ

## งานต่อ V4

- เพิ่มการทดสอบรอ token หมดอายุจริง และลองใช้ refresh token เดิมหลัง Logout: สองกรณีนี้ยังไม่ได้ตรวจใน V3
- หากต้องการปฏิเสธ access token ทันทีหลัง Logout ต้องออกแบบ server-side revocation เพิ่ม ปัจจุบัน JWT อาจใช้ได้จนหมดอายุสูงสุด 60 นาที ส่วน RevokeToken อาจล้มเหลวแล้ว SDK ยังล้าง local session ต่อ
- แยก IAM role จาก shared LabRole และทบทวน credential/config ที่อาจคงอยู่ใน Lambda versions หรือ rollback backups เก่าก่อนเลิกใช้
- เพิ่ม log coverage ของ API Gateway และทบทวน privacy logging; ผล V3 ตรวจเพียงตัวอย่าง Lambda logs ไม่ครอบคลุมทุกบริการหรือทุกช่วงเวลา
- จัดการอายุบัญชี/fixtures ทดสอบ โดย Advisor assignments ของ smoke #83 มีอายุ 7 วัน ไม่ต่ออายุหรือ reset แผนโดยไม่ตรวจเหตุผล
- ก่อนใช้ข้อมูลจริง ต้องกำหนดสิทธิ์ การเก็บรักษา/ลบข้อมูล และการอนุมัติจากหน่วยงาน
- ฟีเจอร์ถัดไปที่ยังไม่มี: notifications, file upload, Admin สำหรับสถานประกอบการ, calendar/deadline, placement tracking และ external integration
- Release tag ติดตามใน [#86](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/86) ต้องผูก SHA ที่จะ tag กับ deployment/ผลตรวจรับจริง และคง tag V1/V2 เดิมไว้

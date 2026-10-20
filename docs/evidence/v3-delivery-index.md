# สรุปงานและผลทดสอบ V3

ผลตรวจรับวันที่ 20 ต.ค. 2569: [#84 — GO สำหรับข้อมูลจำลองและการสาธิต](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/84#issuecomment-6293912895)

- Source: `26a90ec3fe479671683d746642496d4563c51e61`
- Amplify main Job 57: SUCCEED
- Lambda CodeSha256: `jw6Koutmpa3kvfYUIr5nQG0bTQw3bpfkIalCB8+/OKI=`
- [PR #127](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/127) / [CI #39](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/39386303149): ผ่านที่ PR head `56ff49021eefc4ea92ed944cdf7eca0648c0bec0` ก่อน merge

## ผลทดสอบ

| ส่วน | ผลและขอบเขต |
| --- | --- |
| Full regression | 885 tests ผ่าน: 845 Jest + 40 Node TAP ใช้ PostgreSQL ทดสอบแยก ไม่ใช่ RDS |
| Database verification #82 | 13/13 ผ่าน: 12 schema checks และ migration checksum |
| Deployed public/anonymous | 50 checks ผ่าน: V2 10 + V3 40; TAP แสดง 52 เมื่อรวม parent suites |
| Authenticated reads #83 | 43/43 ผ่าน: Advisor 17, Staff 15, Student 11 |
| Mutation denials #83 | 21/21 ผ่าน: Advisor 14, Student 4, Staff 3; ตรวจ 11 ตารางและสรุปแผน 4 รายการแล้วไม่เปลี่ยน |
| Logout หลัง PR #127 | ทดสอบผ่าน Browser ครบ Student/Staff/Advisor: POST RevokeToken 200, แท็บอื่นออกตาม และ Back/Refresh ต้อง Login ใหม่ |
| Logging | ตัวอย่าง Lambda logs 352 records ไม่พบ pattern ที่กำหนด; API Gateway access logs ยังไม่เปิด |
| Token expiry / refresh reuse | รอหมดอายุจริง: SKIPPED; การลองใช้ refresh token เดิมหลัง Logout: ยังไม่ได้ทดสอบ |

การทดสอบสิทธิ์บนระบบจริงใน #83 ใช้ source `d13868d47d9ec7fc7ce26b67b131f97191817df5` ซึ่ง backend/Lambda ตรงกับรุ่นที่ตรวจรับ ส่วน frontend Logout ทดสอบซ้ำหลัง Job 57 ผลในตารางอ้างอิงรุ่นที่ระบุไว้ หากแก้การทำงานภายหลังต้องทดสอบส่วนที่เกี่ยวข้องใหม่

การเปลี่ยนสถานะสำเร็จ การบันทึก audit และคำสั่งที่เข้าพร้อมกันทดสอบผ่าน HTTP/PostgreSQL integration tests ไม่ใช่การอนุมัติแผนจริงบน RDS รายละเอียดอยู่ใน [T01](v3-t01-migrations-constraints-fixtures.md), [T02](v3-t02-authn-authz-boundaries.md), [T03](v3-t03-workflow-transitions-concurrency.md), [UI/accessibility](../frontend/v3-protected-ui-accessibility-verification.md) และ [deployed smoke](../operations/v3-deployed-security-smoke.md)

## Issue และ PR

ตารางนี้ใช้หา source และรายละเอียดของแต่ละงาน ส่วน Decisions D01–D08 ดู [Architecture decision index](../architecture/G03-V3-architecture.md#accepted-decision-index)

| Issue | งาน | PR / การดำเนินงาน | รายละเอียด |
| --- | --- | --- | --- |
| [#55](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/55) | Modular API / shared response-error contract | [PR #89](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/89) | [Record](../api/v3-shared-contract.md) |
| [#56](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/56) | Forward-only identity / Plan / audit migration | [PR #87](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/87) | [Record](../database/v3-migration-002-recovery.md) |
| [#57](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/57) | Authenticated shell / route guards | [PR #94](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/94) | [Record](../frontend/v3-authenticated-shell.md) |
| [#58](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/58) | Cognito / AWS network / runtime configuration | AWS configuration / issue acceptance | [Record](../operations/v3-operating-guide.md) |
| [#59](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/59) | Architecture / trust / privacy decisions | [PR #88](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/88) | [Record](../architecture/G03-V3-architecture.md) |
| [#60](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/60) | Synthetic fixtures / seed guards | [PR #95](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/95) | [Record](../data/v3-fixtures.md) |
| [#61](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/61) | Trusted JWT identity context | [PR #90](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/90) | [Record](v3-t02-authn-authz-boundaries.md) |
| [#62](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/62) | Central role / ownership / scope authorization | [PR #91](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/91) | [Record](v3-t02-authn-authz-boundaries.md) |
| [#63](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/63) | Transactional workflow / immutable audit | [PR #96](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/96) | [Record](v3-t03-workflow-transitions-concurrency.md) |
| [#64](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/64) | Authenticated session /me | [PR #92](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/92) | [Record](../api/v3-shared-contract.md) |
| [#65](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/65) | Student own Profile read / preferred-name update | [PR #93](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/93) | [Record](../api/v3-shared-contract.md) |
| [#66](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/66) | Student own Plan create / read / edit | [PR #101](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/101) | [Record](../api/v3-shared-contract.md) |
| [#67](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/67) | Staff scoped Student / Plan search and review queue | [PR #102](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/102) | [Record](../api/v3-shared-contract.md) |
| [#68](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/68) | Advisor assigned-scope read-only API | [PR #107](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/107) | [Record](v3-advisor-read-verification.md) |
| [#69](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/69) | Student Plan submit | [PR #98](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/98) | [Record](v3-t03-workflow-transitions-concurrency.md) |
| [#70](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/70) | Staff start-review / return / approve | [PR #97](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/97) | [Record](v3-t03-workflow-transitions-concurrency.md) |
| [#71](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/71) | Login / logout / session UX | [PR #99](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/99) | [Record](../frontend/v3-authenticated-shell.md) |
| [#72](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/72) | Student Dashboard / My Profile UI | [PR #100](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/100) | [Record](../frontend/v3-authenticated-shell.md) |
| [#73](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/73) | My Plan editor / Company-Position selectors | [PR #112](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/112) | [Record](../frontend/v3-my-plan-editor.md) |
| [#74](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/74) | Staff Student / Plan search UI | [PR #114](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/114) | [Record](../frontend/v3-staff-student-management.md) |
| [#75](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/75) | Advisor assigned read-only UI | [PR #111](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/111) | [Record](v3-advisor-read-verification.md) |
| [#76](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/76) | Student submission / status / history UI | [PR #103](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/103) | [Record](../api/v3-shared-contract.md) |
| [#77](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/77) | Staff review workspace / actions | [PR #113](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/113) | [Record](../frontend/v3-authenticated-shell.md) |
| [#78](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/78) | Migration / constraints / fixture verification | [PR #104](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/104) | [Record](v3-t01-migrations-constraints-fixtures.md) |
| [#79](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/79) | Authentication / authorization boundary verification | [PR #105](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/105) | [Record](v3-t02-authn-authz-boundaries.md) |
| [#80](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/80) | Workflow / audit / concurrent mutation verification | [PR #106](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/106) | [Record](v3-t03-workflow-transitions-concurrency.md) |
| [#81](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/81) | Protected UI / role visibility / accessibility | [PR #118](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/118) | [Record](../frontend/v3-protected-ui-accessibility-verification.md) |
| [#82](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/82) | Main rollout / strict auth build / DB verification | [PR #123](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/123) | [Record](../operations/v3-operating-guide.md) |
| [#83](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/83) | Deployed security smoke / V2 regression | [PR #125](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/125) | [Record](../operations/v3-deployed-security-smoke.md) |
| [#84](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/84) | Final scoped GO / privacy and security acceptance | [PR #127](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/127) | [Record](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/84#issuecomment-6293912895) |
| [#108](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/108) | Public TU theme / timeline / quick-access UI | [PR #109](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/109) | [Record](../../index.html) |
| [#110](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/110) | Public directory / search-filter presentation | [PR #115](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/115) | [Record](../../company-directory.html) |
| [#116](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/116) | Secrets Manager RDS runtime follow-up | [PR #117](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/117) | [Record](../operations/v3-operating-guide.md) |
| [#119](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/119) | Student workspace / isolated local UI preview | [PR #120](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/120) | [Record](../frontend/local-ui-preview.md) |
| [#121](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/121) | Public session dropdown / shell default route | [PR #122](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/122) | [Record](../frontend/workspace-role-logout.md) |
| [#124](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/124) | Workspace theme / authoritative role navigation | [PR #126](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/126) | [Record](../frontend/workspace-role-logout.md) |

Role ใน Public navbar ใช้ผลที่ backend ยืนยันจาก `/api/v3/me` หลัง PR #126 แทนการอ่าน role จาก ID token ในงานเดิม PR #127 แก้ Logout ของ session ปัจจุบันโดยไม่เพิ่ม admin scope ส่วน #84 ตรวจรับหลัง deploy และทดสอบครบแล้ว

## งานส่งต่อ

วิธี setup/config/migrate/deploy/rollback และข้อจำกัดที่ต้องแก้ต่ออยู่ใน [คู่มือพัฒนา](../operations/v3-operating-guide.md) ส่วน release tag ติดตาม [#86](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/86)

CI ของ security harness: [PR #125 / run #35](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/39325108475) ผ่านก่อน merge เก็บ CI artifacts 14 วันตาม workflow; ผลสรุปที่ต้องใช้อ้างอิงจึงเก็บใน repo ด้วย

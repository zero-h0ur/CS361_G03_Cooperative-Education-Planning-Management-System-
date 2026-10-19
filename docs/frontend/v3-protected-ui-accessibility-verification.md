# V3-T04 — Protected UI, role visibility และ accessibility (#81)

## ขอบเขตและ Source

ตรวจวันที่ 2026-10-19 (Asia/Bangkok) หลัง PR #114 merge เข้า main
`f626efe9babaf30ec3241de332ed1567e7c69963` โดย dependencies #71, #72, #73,
#74, #75, #76 และ #77 ปิดแล้ว เอกสารนี้เป็น Verification-only ไม่มีการเปลี่ยน
Production auth entry point, Runtime code, Permission matrix, AWS หรือ RDS

ผลนี้เป็น Frontend/UI acceptance ของ #81 ไม่ใช่ผล Backend authorization
matrix ของ #83, Deployment acceptance ของ #82 หรือการรับรอง WCAG ทั้งระบบ

## Acceptance matrix

| Acceptance criterion | หลักฐานและผล |
| --- | --- |
| ไม่ Render Private content ก่อน Session check | Shell tests ตรวจ Loading/aria-busy ก่อน Session พร้อม; isolated Chrome ระงับ Session แล้วไม่พบ Protected layout, Advisor workspace หรือ API request ก่อน resolve |
| Navigation/actions ตรง Role | Shell tests ตรวจเมนู Student/Staff/Advisor; Chrome cross-role direct-route matrix 10 กรณีถูกปฏิเสธก่อน Render layout/เรียก Client; Live Student เข้า Staff route แล้ว Access denied |
| Advisor ไม่มี Review mutation controls | Advisor/Staff-review tests รวมกรณีส่ง Staff capability/client ให้ Advisor; Chrome ตรวจ List/Student detail/Plan detail ไม่มี form/input/select/textarea หรือปุ่ม Mutation และทุก Request เป็น GET |
| Public Company Directory ไม่ต้อง Login | Public-page regression tests และ anonymous HTTP smoke: Directory HTML 200 ไม่ Redirect/ไม่โหลด Protected bundle; public Company API 200 ขณะที่ `/api/v3/me` ไม่มี Token ได้ 401 |
| Keyboard/focus/labels/error feedback | Profile/Plan/Review/Search tests ตรวจ Label, Field errors, Focus หลัง Error และ Confirm/Cancel/Escape; Staff browser harness ตรวจ Enter submit และ Focus ไป Error/ผลลัพธ์; ผู้ทดสอบยืนยัน Live Tab/Shift+Tab/Enter ใช้ได้และเห็น Focus ชัด |
| Automated loading/empty/error/success | ชุด Frontend 10 suites ครอบคลุม Session, Student profile/editor/submit, Staff search/review และ Advisor assigned read-only: 247/247 ผ่าน ไม่มี Skip |
| บันทึก Manual accessibility findings | ผล Live keyboard/mobile และ Agent visual review รวมทั้งข้อจำกัดที่ Automation ยังไม่ยืนยัน บันทึกในหัวข้อ Manual findings ด้านล่าง |

## Automated regression ที่รันซ้ำ

รันบน Node.js 20.20.2 / npm 10.8.2 จาก Source main ข้างต้น:

```sh
npm ci
npm run test:frontend
```

ผล: **10 Test Suites, 247 Tests ผ่านทั้งหมด** ไม่มี Snapshot ไม่มีฐานข้อมูล
Production และไม่ใช้ Token จริง ชุดทดสอบที่เกี่ยวข้อง:

- `tests/authenticated-session.test.js`: Session/API contract และ Role context
- `tests/authenticated-shell.test.js`: Loading, Role navigation, guard, public pages
- `tests/login-logout-session-ux.test.js`: Callback cleanup, Logout ล้าง Private UI
  ทันที, Expired session และการกลับเข้าระบบโดยไม่ Redirect loop
- `tests/student-dashboard-profile.test.js`: Official fields อ่านอย่างเดียว,
  Preferred name ที่แก้ได้, validation/conflict และ 401 cleanup
- `tests/student-plan-editor.test.js`: Draft/revision editor, selectors, conflict
- `tests/student-plan-submission-ux.test.js`: Readiness, submit/history, 409/422,
  in-flight/retry และ 401 cleanup โดยไม่แสดง Success ปลอม
- `tests/staff-student-management.test.js`: Safe summary, Filter/URL privacy,
  Pagination, Loading/Empty/Error, Role guards และ canonical Review handoff
- `tests/staff-review-workspace-ui.test.js`: State/capability-gated commands,
  confirm/cancel/Escape focus, in-flight/409/422/403/401 และ Advisor no-mutation
- `tests/advisor-assigned-ui.test.js`: Assigned-scope read-only pages,
  pagination, no-assignment, safe fields และ generic out-of-scope errors
- `tests/company-directory.test.js`: Anonymous Directory interactions

Full regression เดิมบน PR #114 head `114b46d960eb2ac8244bcd7ff4e7123f7aff9032`
ผ่าน **827/827** ใน [CI run 24](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/39273052194)
ก่อน merge Source ของ Runtime/tests ไม่เปลี่ยนจาก head นั้นใน merge commit
ไม่ใช้ CI ของ commit เก่าอ้างแทน required checks ของ PR เอกสารใหม่

## Isolated Chrome checks เพิ่มเติม

ใช้ Production Shell/Client/View modules และ CSS ผ่าน Harness ภายนอก Repo
กับ Synthetic responses เท่านั้น ไม่เพิ่ม Mock authentication ใน `app.js`
และไม่ส่งข้อมูลสังเคราะห์ไป API จริง Font import ภายนอกถูกปิดใน Harness
จึงไม่ถือว่า System-font screenshot แทน Live webfont rendering ทุกอุปกรณ์

- Advisor List, Student detail และ Plan detail ที่ 320/768/1440px: 9/9 Views
  ไม่มี Document horizontal overflow ไม่มี Mutation controls และไม่แสดง
  Institutional email/Review-only fields ที่ใส่เป็น Canary ใน Response
- Advisor Plan UNDER_REVIEW ยังเป็น Read-only ไม่แสดง Start/Return/Approve
- Advisor no-assignment แสดง Empty state
- Deferred Session: Protected layout/Private view และ API calls เป็นศูนย์
  ก่อน Session resolve ใน Browser check
- Cross-role direct routes 10/10 ถูกปฏิเสธก่อน Client call:
  Student → Staff Student/Plan และ Advisor list;
  Staff → Student Profile/Plan และ Advisor list;
  Advisor → Student Profile/Plan และ Staff Student/Plan
- Staff Student/Plan browser checks จาก PR #114: 320/768/1440px, Enter submit,
  Field-error focus, Results focus, Keyword ไม่อยู่ URL และเปิด Review view จริง

Harness เป็น UI verification ไม่ใช่หลักฐานว่า Cognito/Backend ยอมรับหรือปฏิเสธ
Token จริงของ Advisor ข้อหลังยังต้องตรวจใน Multi-role smoke ของ #83

## Live และ Manual findings

Preview ที่ตรวจมี Runtime JS/CSS ตรงกับ Source ที่รวมใน main:

`https://feature-74-staff-student-management.d1d9qrqnsi5nl6.amplifyapp.com`

### ผลจากผู้ทดสอบ

- ยืนยัน Tab / Shift+Tab / Enter บน Staff search ใช้ได้โดยไม่ใช้เมาส์
  กรอก `TESTPR730001` และกด Enter ได้ เห็น Focus indicator ชัดเจน
- ยืนยัน Student search และ Plan search ที่ 320px ไม่ต้องเลื่อนแนวนอน
  ข้อความอ่านได้และปุ่มกดได้
- ภาพ Live validation แสดงปี `2026` ไม่ผ่าน พร้อมข้อความปี พ.ศ. 2500–2700
  Error ไม่ใช้สีเพียงอย่างเดียว และ Focus อยู่ช่องปี
- ภาพ Empty state แสดง Total 0 และข้อความไม่พบข้อมูลพร้อม Results focus
  ไม่ค้างการ์ดของ Student จากคำค้นก่อนหน้า
- ภาพหลังสลับ Student เข้า Staff URL แสดง Access denied โดยไม่แสดงรายชื่อ
- ภาพและรายละเอียด Live Student/Plan/Review handoff อยู่ใน
  [PR #114](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/114)
  และ [Staff search evidence](v3-staff-student-management.md)

### Agent visual review และข้อจำกัด

- ตรวจภาพ Advisor Plan ที่ 320px และ Advisor list ที่ 1440px: Read-only badge
  และคำอธิบายแสดงชัด ข้อมูลยาว Wrap อยู่ในการ์ด ไม่มีปุ่ม Review mutation
- พบ Cycle ใน Advisor Plan ยังแสดง UUID และ Wrap หลายบรรทัดบนจอแคบ
  อ่านได้แต่เป็น Technical identifier ไม่ใช่ชื่อรอบ จัดเป็น Usability finding
  สำหรับงานปรับ Display contract ภายหลัง ไม่เติมชื่อปลอมหรือเปลี่ยน API ใน #81
- ยังไม่ได้ทดสอบ VoiceOver/NVDA, High-contrast mode, OS text scaling หรือ
  Browser/อุปกรณ์จริงทุกชุด จึงไม่อ้าง Screen-reader/WCAG certification
- Responsive emulator 320px ไม่ใช่ Physical-device test ผลผู้ทดสอบและ
  Browser harness ไม่ยืนยัน Mobile browser/IME ทุกแบบ
- Live Advisor identity/assignment และ Backend negative authorization matrix
  ยังไม่ตรวจใน #81; ห้ามใช้ Frontend hidden controls หรือ route denial แทน
  Server-side authorization evidence

## ข้อสรุปและการส่งต่อ

Acceptance criteria ของ #81 มีหลักฐานตามระดับที่ระบุ: Automated regression,
isolated browser checks, Live Staff/Student UI smoke และ Manual findings
ไม่มี Production-code fix เพิ่มจากการตรวจนี้

ให้ Reviewer ตรวจเอกสารและ required checks ของ PR head ล่าสุดก่อน Merge
จากนั้นดำเนิน #82 เพื่อยืนยัน Protected frontend บน main และ #83 สำหรับ
Multi-role live/authz smoke ต่อไป โดยยังไม่สรุป #82–#84 ว่าเสร็จจาก #81

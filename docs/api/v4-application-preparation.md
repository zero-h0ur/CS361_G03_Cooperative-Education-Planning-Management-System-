# Phase 1 application preparation

Issue #141 adds an application domain, not a conversion of legacy V3 Plans. No
accepted company, company position ID, project or Advisor assignment is required.
Review/return/resubmission belong to #142, tracking to #143, history contracts to
#145, and schedule administration to #144. These are proposed integration
contracts; reading the adjacent issues does not mean their owners approved them.

## State and ownership

An active linked Student owns at most one application per cycle. A cycle cannot
be changed on an existing application. `DRAFT` is editable; first submission
atomically creates an immutable snapshot and changes to `SUBMITTED` (รอเจ้าหน้าที่ตรวจสอบใบสมัคร).
Coordinator may read submitted applications only inside the current assigned
cohort. Committee, Staff and Advisor do not gain access through their role alone.
The existing V3 queues/three-opinion process are not changed by this feature.

Commands use UUID `operation_id`, and updates use `expected_version`. Repeating
the same operation/payload returns its result; changing its payload conflicts.
Current identity/scope is rechecked before replay. Replies containing protected
data use `Cache-Control: no-store`. Unknown input fields are rejected.

## Endpoints

| Method | Path under `/api/v4` | Purpose |
| --- | --- | --- |
| GET | `/application-options` | Own cycles, profile and versioned criteria |
| GET / POST | `/applications` | Own list / create a cycle-bound Draft |
| GET / PATCH | `/applications/:id` | Authorized detail / partial Draft save |
| GET | `/applications/:id/readiness` | Field/file blockers and preliminary GPA |
| POST | `/applications/:id/uploads` | Create a private staging upload ticket |
| POST | `/applications/:id/uploads/:ticket/complete` | Validate actual bytes and attach an immutable document |
| POST | `/applications/:id/documents/:document/download` | Authorize a short-lived attachment download |
| POST | `/applications/:id/submit` | Snapshot, lock and first submission |

An application response includes `id`, `cycle_id`, `status`, `version`, declared
`payload`, server-owned `official`, policy metadata, current attachment metadata,
and `submitted_at`. Object keys and long-lived storage access never appear in
Student JSON. Document metadata includes its ID, category, name, size, content
type and checksum, never document bytes or public URLs.

The handoff to #142 is `application_id`, `cycle_id`, `student_id`, `version`,
`status`, `submitted_at`, `submission_id`, `policy_id` and immutable document IDs.
No legacy `plan_id` is fabricated. Application-scoped operation/events are stored
atomically; history does not contain guardian values, document contents or signed URLs.

## Academic policy

The supplied 2568 criteria are a team baseline for 1/69, not an official 2569
announcement. Source year and policy version are preserved. Curricula 61/66 have
different required/alternative groups. GPAX must be at least 2.75; group GPA at
least 2.50, computed as sum(points * verified credits) / sum(verified credits).
Compare before rounding for display. CS302/CS301 are future obligations to
acknowledge, not courses that must already be passed at application time.

The policy snapshot also pins `effective_criteria`: baseline identifier, source
year, GPAX/group minimums, entry-year cutoff, required/alternative/additional
groups and future-course obligation. It does not rely on future source-code
constants to explain a previously submitted eligibility check.

The team has not provided verified credits or repeat/alternative-course rules.
Real applications can save Drafts and upload files but must show
**รอยืนยันข้อมูลเกณฑ์** and cannot submit until verified policy and academic
identity metadata exist. Students cannot edit credits or mark data verified.
Synthetic metadata is restricted to explicitly labelled Preview/isolated tests;
it cannot unblock real submission. Missing round windows likewise cannot be
invented; #144 can supply the separate versioned availability record.

## Documents

- Resume, Transcript, conduct certificate: PDF, at most 10 MiB each.
- Student photo: JPEG/PNG, at most 5 MiB.
- One current file per category; old finalized versions remain available to an
  already-submitted snapshot. Replacing a Draft file does not detach the old file
  until the replacement upload, content checks and database update succeed.

The server checks actual size/signature/checksum, ownership, editable state and
application version. Content validation is not malware scanning, OCR, or proof
of an instructor signature. File inputs are ordinary keyboard-operable controls.

Upload bytes go to a unique private staging target, not a base64 JSON field.
Completion reads bounded bytes, validates them, writes a separate finalized key
that has never been an upload target, and commits its pointer/version/event in a
database transaction. An expired/replayed upload cannot overwrite finalized
documents. A failed DB transaction may leave an unreferenced private object;
cleanup/retention requires a separately approved policy, not silent deletion.

Production uses a configured private S3 store; development may explicitly enable
a private filesystem store and authenticated binary routes. Local storage is
forbidden in Lambda/production. Missing configuration returns a visible error,
never a fake upload success. Download authorization is repeated for every URL;
an issued URL remains a bearer capability until its short expiry.

## Operational boundary

This change does not provision a bucket/IAM/network route, migrate production,
replace authentication, send notifications, publish selection results or deploy.
Before real intake, owners must verify academic metadata, configure private
storage and CORS/CSP/grants, agree file retention/scanning and test actual access.

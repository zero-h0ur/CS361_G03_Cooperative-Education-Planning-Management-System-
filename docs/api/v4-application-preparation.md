# Phase 1 application preparation

> Baseline #141 contract, preserved for compatibility/history. The versioned pending-academic path and Coordinator intake controls are later extensions; see [current V4 architecture](../architecture/G03-V4-architecture.md). This file alone does not establish current AWS permissions, policy or rollout state; use [current deployment](../operations/current-deployment.md).

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

An application response includes `id`, `cycle_id`, `status`, `version`, `form_version`, declared
`payload`, server-owned `official`, policy metadata, current attachment metadata,
and `submitted_at`. Object keys and long-lived storage access never appear in
Student JSON. Document metadata includes its ID, category, name, size, content
type and checksum, never document bytes or public URLs.

The handoff to #142 is `application_id`, `cycle_id`, `student_id`, `version`,
`status`, `submitted_at`, `submission_id`, `policy_id` and immutable document IDs.
No legacy `plan_id` is fabricated. Application-scoped operation/events are stored
atomically; history does not contain guardian values, document contents or signed URLs.

## Staff reference form: version 2

The Student editor follows six stages: identity/contact, academics,
interests/seven declarations, documents, emergency guardian, and review/first
submission. Next/Back and step links do not send or discard data. Save Draft is
available throughout, including incomplete applications. Readiness and final
confirmation remain separate, explicit actions.

These are additions to the existing CO-ED backend API, **not** changes to TU API
or a Google Forms integration. The current university record exposes canonical
`official.full_name`, student number, institutional email and academic metadata;
it does not yet expose a verified prefix or names split by language. Missing
language-specific names/prefix are explicitly applicant-declared application
values, never updates to the official identity. If trusted language-specific
fields are provided later, the corresponding controls become read-only and the
backend rejects a conflicting declared value. No translation is invented.

New allowlisted `payload` fields:

| Field | Contract |
| --- | --- |
| `name_prefix` | Declared prefix, up to 100 Unicode characters |
| `thai_full_name`, `english_full_name` | Declared language-specific names, up to 200 characters each |
| `contact_email` | Contact email distinct from university email, up to 254 characters; valid syntax required for submission |
| `major_group` | CIS or ACS required for new submission; legacy free text can still be saved in Draft until explicitly converted |
| `gpax_reporting_term` | Applicant-declared reporting term from Transcript, up to 100 characters; not a verified schedule |
| `declared_group_gpa` | Applicant-declared decimal 0–4, at most four decimal places; separate from computed `group_gpa` |
| `interested_position_codes` | Multiple codes: FRONTEND, BACKEND, IOS, ANDROID, FULLSTACK, SYSTEM, SOFTWARE, BA, UI_UX, DATA, OTHER |
| `interested_position_other` | Up to 500 characters, required when OTHER is selected |
| `skills_detail` | Plain multiline text, up to 5,000 characters |

Existing `interested_positions` and `skills` arrays remain readable/saveable for
Draft compatibility. Legacy interests are displayed, not automatically matched
to new codes. The old skills array is the fallback only until `skills_detail`
is explicitly edited; an explicitly empty new field does not silently reuse the
old skills. New incomplete/invalid-format Drafts remain saved where structurally
valid; readiness explains what prevents submission.

`acknowledgements` now has seven independent boolean keys: `program`,
`required_courses`, `additional_courses`, `preplacement`, `gpax`, `conduct`,
`terms`. Every key must be true for a new submission. The four new confirmations
are never inferred for old Drafts. Changing curriculum in the editor clears the
three curriculum-dependent confirmations and keeps existing grade attempts.

Letter-grade controls map A/B+/B/C+/C/D+/D/F to 4/3.5/3/2.5/2/1.5/1/0. Existing
decimal grades remain visible without rounding or conversion. The unselected
CS213/CS216 alternative is not a fabricated F; its existing attempts are retained
but not used instead of the selected course. Curriculum 61 retains **CS264** as
specified in the previously confirmed criteria and the reference's explanatory
text, despite the inconsistent CS261 grid label in one screenshot.

The selected intake supplies its heading/year; the screenshot's 2570 title and
Summer 3/2568 reporting term do not create a verified intake or replace the
existing criteria. Declared GPA/attestations never unblock an unverified policy.

New submission snapshots pin `form_version: 2`, the full declared payload and
the existing official/policy/document/acknowledgement evidence. Submitted views
read the pinned payload. Old snapshots without a form version are returned as
version 1 and receive no new fields, declarations or retroactive validation.
The existing JSON payload/snapshot schema supports this extension; no new
migration, old-migration edit, checksum rewrite or data backfill is required.

## Academic policy

**Updated requirement, 2026-11-08:** the owner has now confirmed actual department credits/repeat/program-course rules. Current new-Draft/Submit and review behavior follows [confirmed criteria](v4-confirmed-academic-criteria.md). The paragraphs below describe the earlier baseline and missing-policy limitation; original submissions retain that history. This source update does not itself publish a verified policy to RDS.

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

All four categories, including the conduct certificate, remain required as
explicitly reconfirmed by the owner. The reference Google Form's 100 MB photo
limit and multiple PDF uploads are **not** adopted. Filename suggestions use
student number (Resume/CV: `CV-<student-number>.pdf`); they do not rename files
on the student's computer or silently reject an otherwise valid upload by name.

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

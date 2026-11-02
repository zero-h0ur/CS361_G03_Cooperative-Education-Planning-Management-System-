# Student workspace redesign — local implementation

Date: 2026-11-02. Branch: `feature/student-workspace-redesign`, based on `79db1ef`.

## Scope and design

Implemented the three user-selected mockups using `frontend-design` and `ui-ux-pro-max`: white horizontal Student navigation, the existing campus watercolor banner, the profile identity strip/cards, a burgundy latest-application feature, previous applications, and a left-hand six-step editor. Other roles keep their previous shell.

The local design-system searches returned unrelated directory/product-demo suggestions. These were not adopted; the approved images and web UX guidance determined the layout and colors. No new UI packages, generated artwork, or external font requests were added.

Profile contact email was explicitly approved as an API extension. `contact_email` is independent of read-only `institutional_email`. Address and phone editing remain supported. Profile changes preserve submitted application payloads, document snapshots and checksums; an isolated PostgreSQL test verifies this after an actual profile mutation.

## Honest data and interaction rules

- No example student identity, faculty, English name, curriculum or year is substituted for missing live data.
- Application summaries do not contain a saved editor step. The six neutral sections are not a percentage or a claim that a step is complete.
- A resumable draft is preferred for the featured action. Other drafts remain accessible, and a closed draft says “ดูฉบับร่าง”, not “กรอกต่อ”. Missing round metadata uses a neutral open action.
- Creating a new draft requires choosing an available round. Already-used rounds are excluded; retries retain their operation ID.
- Save Draft and Next are separate. Next changes the visible section without silently saving/submitting. Dirty departure guards, file retries, readiness checks and explicit submission confirmation remain.
- Contact edit retains typed values after failures, protects dirty departure, uses version/operation ID, and requires consent before reloading over edits.
- Desktop has a sticky action footer with focus-overlap handling. On narrow screens it returns to document flow; the navigation adapts to avoid three crowded horizontal labels.

## Automated verification

All results below are local, not production acceptance evidence. Counts overlap between suites and should not be summed.

| Check | Result |
| --- | --- |
| `npm run test:frontend` | 372 tests passed, 16 suites |
| Application UI/API, three-role UI, Preview Jest suites | 126 tests passed, 4 suites |
| Profile API and new contact-email unit tests | 38 tests passed |
| PostgreSQL application, three-role workflow and migration integrity | 52 tests passed, none skipped |
| Runtime ACL against disposable local PostgreSQL | 3 tests passed |
| `npm run test:release` with local test database | 26 tests passed, none skipped; ZIP tests did not deploy |
| Preview server / production dependency graph | 2 tests passed; synthetic fixtures excluded from production graph |
| `npm run test:docs` | 9 tests passed; 37 documents / 149 local links, zero network requests |
| `npm run test:v4-build` | Passed |
| `npm run build:v4` | Passed; local artifacts only |
| `npm run lint` | 186 JavaScript modules passed |
| `git diff --check` | Passed |

Database tests used a newly initialized cluster under ignored `tmp/student-workspace-pg-20261102`, bound only to `127.0.0.1:55432`, database `coed_v3_test`. No existing database or AWS account was used. Tests that create/drop their own schemas ran sequentially to avoid extension setup races. Windows test runners use the installed Python command and directory junctions without weakening the existing assertions; lint traversal now classifies nested ES modules correctly on Windows.

## Visual verification limits

The profile and editor header/rail were visually inspected in a dedicated, unauthenticated Chrome profile at Desktop size (1536-pixel window). The private GitHub browser was not opened or inspected. The native helper subsequently failed with `failed to activate captured window`; one documented recovery attempt also failed, so UI automation stopped.

Before merge, manually verify these remaining visual cases; automated DOM tests are not a substitute for geometry or real keyboard/browser behavior:

- [ ] All-applications list at Desktop size, including draft plus historical record.
- [ ] All three screens at 375px and browser zoom, without horizontal overflow.
- [ ] Real keyboard traversal, visible focus, reduced motion and focused controls above the Desktop action footer.
- [ ] Long text, empty list, multiple drafts, closed rounds, and load/save failures in a real browser.

## Reproduce the isolated Preview

Run `npm run dev:ui`, then open these local-only URLs:

- Profile: `http://localhost:8081/app.html?scenario=application-overview#/student/profile`
- All applications: `http://localhost:8081/app.html?scenario=application-overview#/student/application`
- Six-step editor: open “กรอกใบสมัครต่อ” from either page above.

The scenario selector also includes empty, multiple-draft, closed, long-text, list-error and round-lookup-error cases. Preview data and documents are fictional. Its server rejects API calls; no Cognito or AWS configuration is needed. Use Ctrl+C to stop it.

## Release boundary

No push, PR creation, merge, deployment, production SQL or cloud resource changes were performed. The user will create the new issue and review the branch.

The new API requires forward-only migration `011_student_contact_email.sql` and the updated narrow runtime column grant before deploying the matching Backend. Migration 001–010 and their checksums remain unchanged. Do not deploy only the new Frontend against an older Backend/database contract. A separately approved release must include preflight, migration/grants, matching Backend/Frontend and smoke tests, following `Push → PR → Review/Merge → user confirmation → Deploy` unless the user explicitly authorizes a particular manual release.

# Advisor workspace: CO-ED theme and assigned-scope reading

## Scope

The Advisor workspace uses the same animated CO-ED logo, sidebar, session bar,
compact heading and softly faded campus artwork as Student/Staff. All three
existing routes remain read-only:

| Route | View |
| --- | --- |
| `#/advisor/students` | Assigned Students, refresh and existing pagination |
| `#/advisor/students/:studentId` | Safe Student profile and their Plan list |
| `#/advisor/plans/:planId` | Safe Plan references, status, notes and dates |

Student/Plan cards use semantic lists, labelled navigation links and wrapping
content instead of a fixed-width table. Empty states explain that Staff must
assign Students before an Advisor can view them. Refresh clears the displayed
data before loading again; denied or revoked detail access shows the same generic
unavailable message used for unknown resources. When refresh removes a focused
control, focus returns to the reading heading only if the user has not focused
another control while waiting.

## Permission and data boundaries

- Existing Advisor client and GET API/response allowlists are unchanged.
- Backend active-account, role and effective-assignment checks remain authoritative.
- No edit, submit, approve, return, reject, assign or upload controls are added.
- No Student contacts, identity-link claims or Staff review comments are exposed.
- Notes remain notes, not a fabricated Project field. No company confirmation,
  CV/Resume access, Plan history or cycle name is inferred from missing fields.
- The five-Student capacity rule belongs to a separate Staff/backend assignment
  workflow. This UI neither enforces it nor hides assigned results beyond five.
- No new API, database change, Cognito configuration or permission bypass.

## Local UI Preview without AWS

```powershell
npm.cmd run dev:ui
```

Open:

- List: `http://localhost:8081/app.html?role=ADVISOR#/advisor/students`
- Student: `http://localhost:8081/app.html?role=ADVISOR#/advisor/students/40000000-0000-4000-8000-000000000101`
- Plan: `http://localhost:8081/app.html?role=ADVISOR#/advisor/plans/50000000-0000-4000-8000-000000000101`

Use the Preview toolbar to choose Advisor and a scenario:

| Scenario | Expected behavior |
| --- | --- |
| `assigned` | Three synthetic Students; first Student has an approved example Plan |
| `unassigned` | No Student details; explain Staff assignment and offer refresh |
| `no-plans` | Student visible, but their Plan list is empty |
| `long-text` | Long Thai names wrap without hiding the navigation action |
| `revoked` | List is visible; opening a detail shows generic scope denial |
| `loading` | Loading status persists until navigating away/changing scenario |
| `error` | Service failure with a retry action |
| `expired` | Existing expired-session screen replaces private content |
| `forbidden` | Advisor list access denied |

Example empty URL:
`http://localhost:8081/app.html?role=ADVISOR&scenario=unassigned#/advisor/students`

Example revoked-detail URL:
`http://localhost:8081/app.html?role=ADVISOR&scenario=revoked#/advisor/plans/50000000-0000-4000-8000-000000000101`

Preview fixtures are synthetic presentation data with four read-only methods;
they make no fetch calls and are excluded from both production dependency graphs.
The loopback Preview server retains its no-network CSP and API denylist. This is
not an authorization emulator. Restart the Preview server after source edits;
it builds into memory on startup and does not provide hot reload.

## Verification

```powershell
npm.cmd run test:frontend
npm.cmd run test:ui-preview
npx.cmd --no-install jest --runInBand tests/advisor-read.test.js --testNamePattern '^(?!.*PostgreSQL and Lambda integration)'
npm.cmd run build
git diff --check
```

The full `npm.cmd run test:advisor` also runs five PostgreSQL/Lambda integration
tests that call `seedV3()`. They require an explicitly approved disposable test
database/reset setup. Do not enable reset flags or reuse a shared/production
database just to run this UI verification.

### Results recorded for this change (2026-10-21)

- Frontend: 13 suites, 310 tests passed.
- Preview: 39 component tests and 2 server/bundle-isolation tests passed.
- Advisor backend unit checks: 13 passed; 5 PostgreSQL integration tests excluded.
- Initial full Advisor suite attempt was blocked by the existing reset safety
  guard (`ALLOW_DB_RESET` not enabled), before seed/database writes. It is not
  reported as a passing integration run.
- Production build and `git diff --check` passed.
- Documentation scanner passed for the repository entry documents and the two
  affected frontend guides. The optional full documentation unit suite had 8
  passes and 1 environment failure: Windows denied creating its test symlink
  (`EPERM`). No OS permissions were changed to bypass that restriction.
- Preview was restarted with the final source and returned HTTP 200 with its
  `connect-src 'none'` CSP intact.
- Browser inventory contained no connected browser; visual/viewport/keyboard
  manual checks and real Cognito/API smoke checks remain pending.

### Browser manual review

- [ ] Compare Advisor logo/sidebar/background/compact spacing with Student and Staff.
- [ ] Check all three Advisor routes at 320, 768 and 1366px, including long names.
- [ ] Use Tab/Shift+Tab/Enter for Student and Plan links, refresh and pagination.
- [ ] Verify visible focus and the skip link; no page-wide horizontal scrolling.
- [ ] Enable reduced motion and verify the inherited logo effect is reduced.
- [ ] Exercise no-assignment, no-plan, loading, failure/retry and expired states.
- [ ] Open revoked and guessed detail IDs; show no resource-existence distinction.
- [ ] Confirm no mutation controls or misleading five-seat quota are displayed.

### Real environment checks (separate from Preview)

With appropriate real Advisor test accounts, verify no-assignment/active/revoked
assignment access, cross-role route denial, API GET-only behavior and safe response
fields. Verify Student and Staff routes retain their existing behavior. Preview
success does not establish Cognito, API Gateway, RDS or deployed-permission success.

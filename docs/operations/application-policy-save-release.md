# Draft curriculum policy-save release — 2026-11-17

Status: **Backend deployed; operational smoke passed; subsequent persisted Student submission observed; Coordinator blocked by an earlier Committee finalization**.
Final Backend readback: `2026-11-17T15:25:36.123Z` (**22:25, Asia/Bangkok**).
This is a record of the owner-approved release, not standing approval for another operation.

## Problem and code

Source commit: `38d5cd7f74d5dc937f83277598f9db52c6c335c2`, branch
`fix/141-application-policy-save`, based on `791ed1e`. The owner committed and
pushed the patch before deployment. The source tree was clean at packaging and
cutover. Its three-file delta contains the application service fix, a PostgreSQL
regression test, and the [Draft policy contract](../api/v4-application-preparation.md#draft-policy-guard).

A new Draft could have no stored curriculum/policy. Selecting a curriculum in
the form made Save compare the newly selected policy with the previously loaded
`null` policy ID, causing `POLICY_CHANGED` even though that policy had not changed.
Save now checks the policy for the stored Draft before applying the curriculum
edit, then returns the selected curriculum's current policy. A real change to
the stored curriculum's policy still conflicts and rolls back. Submit retains
its separate latest-policy, readiness, document, destination and transaction checks.

## Observed deployment

| Target | Verified result |
| --- | --- |
| AWS account / Region | `130165494095` / `ap-southeast-2` |
| `coed-api:live` | **16**, previously **15** |
| Backend source | `38d5cd7f74d5dc937f83277598f9db52c6c335c2` |
| Lambda code SHA-256, base64 | `x0ye/3y4+XmuV71yxQ2KLJ8Ft3bTpoxFjzPgBOAKW5E=` |
| ZIP bytes / entries | **789,764 / 21** |
| ZIP SHA-256 | `c74c9eff7cb8f979ae57bd72c50d8a2c9f05b776d3a68c458f33e004e00a5b91` |
| Public RDS CA SHA-256 | `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b` |
| TU broker / private issuer | **5 / 4**, aliases and configuration unchanged |
| Amplify branch | `d1bpmj87vmjb96` / `main`, existing manual job **38**, `SUCCEED`, auto-build disabled |

Fresh preflight confirmed API15's code hash, numeric alias, configuration and
matching `$LATEST`. The retained API15 ZIP matched
`daa63234d8f98f7219352e83b26fa03ac9b000c07eb9e8af26c6970daa55f159`.
Comparing every ZIP entry showed that only `src/lambda.js` changed; the migration
runner, all SQL, verification SQL and public CA were byte-identical.

The approved operation updated code with the expected `$LATEST` revision,
published numeric version 16 using the exact code hash/revision, verified that
candidate, then moved `live` conditionally from 15 to 16. Final readback confirmed
the alias, code hash and preserved configuration. No rollback was needed.

The existing environment was preserved exactly, including
`COED_API_MAINTENANCE=off`, `COED_INTAKE_AUDIENCE=routed-tu-students` and
`COED_INTAKE_CONTROLS_REQUIRED=true`. This release did not change those gates.
Retained private bindings are deliberately omitted. TU configuration/aliases,
Gateway routes/integrations/CORS and Amplify branch metadata matched their
preflight values. No SQL, identity linking, Student data correction, IAM,
network, storage or Frontend deployment was performed. No fresh RDS catalog,
policy rows, intake-control state or review dates were queried by the operator.

At `2026-11-17T15:26:17.254Z`, Amplify job 38 was read back as `SUCCEED`, and
the three served Frontend assets still matched the retained job-38 release:

| Served asset | SHA-256 |
| --- | --- |
| `runtime-config.js` | `12dc27be782d5a338f69ad06cb18466034712f7c819005e8ea6c6a2f65ab95e2` |
| `assets/authenticated-shell.js` | `bf2bc8e05db441692ec833844d18f73a82b3523bba7699caf458cdcf7fca8e8c` |
| `assets/authenticated-shell.css` | `e6a565bb3102b9aa9b8769cc0a791201523042441484b1da34173178f65bd09e` |

## Verification and limits

### During this release turn

- The final ZIP ran outside the checkout with only its packaged files: health
  returned 200 and anonymous session/options/application reads returned 401.
- Published candidate 16 passed seven direct Lambda **GET-only** probes: health
  and public directory returned 200; direct session, TU-proxy session,
  application options/list and Coordinator options returned 401.
- Through the actual Gateway, directory returned 200; direct session, TU-proxy
  session and Coordinator options returned 401. Exact-origin TU-proxy CORS
  preflight returned 204.
- Numeric alias/code/configuration and unchanged TU/Gateway/Amplify metadata
  were read back. Public directory success exercises a real database read;
  anonymous rejection does not prove authenticated access or a successful Save.
- No authenticated claims, Student writes, private-file downloads or Submit
  were fabricated. Full regression and disposable PostgreSQL suites were not
  rerun during the deployment turn.
- The documentation follow-up passed `npm run test:docs` (9 tests, no skipped
  tests or broken links) and `git diff --check`.

### Prior local verification of the exact patch

Before the owner committed it, Node.js 22 and `npm ci --offline` were used with a
task-owned PostgreSQL 16 tmpfs container on loopback port 55444. Synthetic test
databases were separate from RDS/retained development data. The container was
removed after testing.

- `test:application`: 19 Node checks, zero skips, plus 61 Jest checks. The new
  regression reproduced `POLICY_CHANGED` before the fix and passed afterward.
  It covers first curriculum selection, switching curricula, retained fields,
  idempotent replay, a genuine later policy change, rollback and no submission.
- `test:student-intake`: 51 Node checks, zero skips, plus 7 Jest checks.
- `test:coordinator`: 17 Node checks, zero skips, plus 60 Jest checks.
- `test:phase1-schedule`: 20 Node checks, zero skips, plus 24 Jest checks.
- `test:lambda`: 37 Jest checks and 2 packaging checks, zero skips. Lint passed
  for 350 modules; reviewed migration verification and documentation checks passed.

These are overlapping focused results, not a unique total or proof of the
complete live Student → Coordinator → Committee → results workflow.

## Student retry and recovery

Follow-up at **22:47 Asia/Bangkok**: the owner provided a Coordinator view after
the Student's submission attempt. A scoped GET-only inspection found the new
persisted pending submission at 22:36:45, with academic readiness
clear. The valid saved review interval did not enable Coordinator actions because
the Committee had finalized the same round earlier. See the
[finalized-round diagnostic](coordinator-finalized-round-diagnostic.md) for the
separate transport, source, findings and limits. This does not establish a passed
full workflow or genuine operator Cognito authentication.

The owner was asked to have the Student click **บันทึกฉบับร่าง** on the existing
form before refreshing, to retain unsaved inputs. After a successful Save, the
Student should review the returned criteria, readiness and documents, then
explicitly confirm Submit. Record actual success or the next error separately;
deployment smoke alone does not establish successful application delivery.

Version 15 remains the exact pre-release rollback target, with the same schema
and environment. Any later rollback needs a fresh alias/revision/configuration
check and explicit approval. Do not restore the database or rerun SQL to undo
this code-only change.

Private manifests, revision checkpoints and the one-off guarded operator remain
ignored/local-only under `tmp/release-candidates/policy-save-38d5cd7/`. They are
not a supported deployment interface or guaranteed to exist in another clone.
The source/artifact/target/verification bindings above are the sanitized handoff.
See [current deployment](current-deployment.md) for the dated snapshot and
[intake verification](student-intake-verification.md) for earlier evidence.

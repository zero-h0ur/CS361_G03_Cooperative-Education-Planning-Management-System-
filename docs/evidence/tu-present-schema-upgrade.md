# Observed-schema TU delivery upgrade: local evidence

Date: 2026-11-04 (Asia/Bangkok). Source baseline `480e1cc`, branch
`fix/tu-phase1-coordinator-delivery`. New work is not committed or pushed.

Status: actual schema captured read-only and temporary AWS resources removed;
new upgrade SQL and isolated tests implemented. No production SQL/grant/identity
change, application deployment or real TU login was performed in this phase.

## Approved baseline choice

The user explicitly chose to use the actual present schema as the reviewed
baseline despite unavailable original014/015 SQL. This is **not** recovery of
those files, proof of their historical DML, or permission to rewrite their names
or checksums. Ask before business-data correction, identity relink, uncertain
shared privilege changes or maintenance/cutover.

The finalized decision is recorded in ignored local plan/grilling artifacts:
`docs/plans/2026-11-04-production-lineage-local-upgrade.md` and
`tmp/grill-me/outcome-01a03e5c-406b-7eb3-900f-f6180e4b0bb5-20261104-211531.md`.

## Actual read-only capture and cleanup

- Exact account `130165494095`, Sydney, database `coed`, runtime user `coed_app`.
  No master credential was read. Verified database/user, REPEATABLE READ and
  READ ONLY guards all true; PostgreSQL160015. Fixed catalog queries only, no
  applicant rows, files, identity check, arbitrary SQL or function invocation.
- One invocation of the exact new immutable reader version `2`.39 application
  tables,368 columns,277 constraints,98 indexes,35 enabled triggers and17 selected
  trigger/provisioning routines were captured, plus catalog ACL/dependency metadata.
- The writer credential was loaded only in AWS memory; read-only behavior was
  enforced by code and transaction, not by a newly provisioned DB role.
- Full safe response347038 bytes, SHA256
  `16025b7020688601bbf9d3099ab53c0e575cacb6f3e4e58b5e94ae831345d3c1`.
  Ignored original: `tmp/main-alignment/tu-preflight-fgmJQZ/result-1.json`.
- Checked cleanup completed `2026-11-04T15:37:19.112Z` (22:37 Bangkok): temporary
  reader/version/role/policy/log group deleted; own endpoint statement removed.
  `endpointEqualsOriginal=true`, `applicationUnchanged=true`. Normal AWS service
  audit history is not claimed erased. Shared network/resources were not deleted.
- API/TU code/revisions and Gateway integrations still match the earlier
  [D0-D6 evidence](tu-aws-preflight-readonly.md); no issuer or application alias
  was deployed.

The reviewed metadata is stored compressed in
[coed-present-20261104.json](../../scripts/operations/baselines/coed-present-20261104.json).
It contains schema/ACL definitions only, no business records or credentials.
Bounded decompression validates payload SHA256
`3e5f1754746fd2b90522e38ffc40b7096f30a99a760593e3bc5dbcb6214baf6d`.
Compression keeps the full catalog compact; it is not an executable historical
migration. The loader and all upgrade callers are operator/test-only, not runtime
HTTP handlers.

## Verified findings

Production retains16 exact history entries: reviewed001-013 workspace plus schedule
SQL recorded as013 and the unavailable014 handoff/015 audit files. Local017 is
unapplied. The schedule table exists; newest delivery/link-audit tables and the
dedicated SELECT-only login role do not.

The actual `guard_phase1_application` definition references `r.status='RETURNED'`
against `phase1_reviews`, whose actual column is `state`. The isolated fixture
reproduces SQLSTATE42703 before the upgrade. PostgreSQL plans the expression even
when a runtime branch might not need it; application UPDATEs can fail, not only a
particular return action. The new guard uses the reviewed workspace state/version/
snapshot transition rules. This proves a schema/trigger defect, **not** the exact
exception of the historical deployed `/tu-login`500.

The actual `SECURITY DEFINER upsert_tu_student_identity` can create/reactivate
identity links and create/update Student official fields, including provider-based
department/program and a hardcoded entry-year value. Its execution is granted to
PUBLIC and `coed_app`; it was inspected, never invoked. This does not establish
which real rows were affected. The new local SQL retains its definition but
removes its exact9-text-argument runtime/PUBLIC execution grants. Live application
dependencies and timing require coordinated cutover; no live grant was removed.

## Exact new source and behavior

- [018_observed_tu_delivery.sql](../../src/db/upgrades/018_observed_tu_delivery.sql):
  upgrade-only, outside normal fresh-install migration inventory. Adds immutable
  delivery receipts and link-event audit structures, repairs actual application/
  attachment guards, scopes review by the sent snapshot/receipt, and retires the
  exact legacy routine capability. **No historical delivery backfill or business
  DML.** Original tables, rows, snapshots and immutable schedule-event trigger stay.
- [018-observed-runtime-grants.sql](../../src/db/operations/018-observed-runtime-grants.sql):
  exact targeted ACL delta, not a full reset of shared grants. Removes broad
  mutation grants on the observed Committee/Coordinator audit/review/schedule/
  result objects; grants only required versioned columns and receipt INSERT
  columns. No CASCADE, shared schema revokes, new login or credential.
- [present-schema-upgrade.mjs](../../scripts/operations/present-schema-upgrade.mjs):
  explicit dedicated owner connection/profile/database/schema; default rollback
  trial. No CLI Apply, AWS client, ambient connection URL or app entry point.
  Apply requires an explicit maintenance decision. This flag is an operator guard,
  not an authorization substitute; database ownership is the authority boundary.

The library requires exact16-entry history and exact normalized observed catalog,
owner `postgres`, bounded SQL/lock timers and migration advisory lock563003056.
It blocks concurrent writes under table locks, compares old-row fingerprints
inside the transaction, applies schema+ACL together, checks exact post-catalog and
runtime effective capabilities, verifies old history unchanged, then appends only
018 or rolls the whole trial back. Raw SQL errors/business values are not returned.
Replay requires the exact018 checksum and postconditions, not just table existence.
Unknown/partial layout, changed/disabled guard, unknown history or unexpected
callable elevated function fails closed. The normal migrator still rejects the
external history; no aliases or checksum rewrites were added.

Pinned source hashes:

| Artifact | SHA256 |
| --- | --- |
| Upgrade018 | `1b5712d287ad44ef745a0f4c862df53b17aa9586329aa5487faf8d1bb65109e0` |
| Targeted ACL | `53d375ac7a7ec4b277b9371b0518fd8ce734f6348552eef1cdd74b9a1a4cc73a` |
| Normalized before catalog | `2988bfe6ed37d7622c457e08a9696fc51bf6772675817b1a58d4a023a2f7d59c` |
| Normalized after catalog | `d916231f32114e668fb5b7720e8739833716f5d21c3653001974a60e39e63b0a` |

Only schema qualification and OID-dependent dependency ordering are normalized.
Different constraints/guards/permissions are not ignored. The separately reviewed
issuer role's grants are checked by its own role contract rather than equated with
the old observed runtime. For fixture round-trip fidelity, three known001-013
BETWEEN/NOT IN predicates use their authentic source form; runtime comparison was
not weakened to hide PostgreSQL deparser AST differences.

## Local validation

All database checks use the task-owned PostgreSQL16 container, loopback55440,
explicit `_test` database and synthetic users/credentials/files. Real TU verification
and Cognito claims are simulated at their trust boundary; HTTP and PostgreSQL are
real. No external login or real account/password was used.

- Schema reader unit/package tests38 passed; a separate real PostgreSQL read-only
  query/denied-write test passed,0 skipped, before the AWS invocation.
- Final observed upgrade+HTTP gate: **31 passed,0 failed,0 skipped**.
- Final offline schema/operator/source unit gate: **42 passed,0 failed,0 skipped**.
- Tests recreate the observed schema and compare the full catalog hash before
  applying anything. Synthetic legacy rows are inserted before installing the
  observed broken trigger, representing rows that predate it; no live or test
  runtime guard is disabled during the actual assertions.
- Trial rollback; populated-row and old-history timestamp preservation; no
  fabricated old receipt; exact replay; concurrent upgrade; direct runtime-owner
  denial; unknown history; disabled/partial schema; unexpected elevated routine;
  post-DDL/ACL failure rollback; safe errors; actual42703 reproduction and repaired
  legacy return; immutable old submission; narrowed effective runtime rights.
- The same real HTTP Student-to-Coordinator suite runs on the observed upgraded
  fixture and normal fresh local lineage. It covers login/session ownership,
  four real synthetic file uploads/downloads, atomic delivery/retry/race rollback,
  cross-owner/scope denial, Coordinator queue/detail, returned correction and
  preserved prior evidence.
- CI adds a separate disposable PostgreSQL job and offline tooling tests; no AWS
  credentials, production URL or deployment permission. These CI changes have
  not been pushed or executed remotely.

Additional final verification (counts overlap; do not sum as unique tests):

| Check | Result |
| --- | --- |
| Full `npm.cmd test` on explicit local fixture URLs | Exit0; includes auth127, main/fresh delivery, migration/ACL/HTTP/UI/package/build regressions |
| Existing release gate within full run |32 passed,0 skipped; unchanged committed001-014/017 source inventory |
| Coordinator supplemental suite |27 Jest +8 PostgreSQL tests passed,0 skipped |
| Committee supplemental suite |9 Jest +1 PostgreSQL test passed,0 skipped |
| Isolated UI Preview |48 Jest +2 server tests passed |
| Syntax lint |265 JavaScript modules passed |
| Docs |9 tests,52 reachable documents,193 local links,0 failures |
| Reviewed historical migrations |All15 unchanged registered hashes passed; no EOL/checksum rewrite |

The first full run's Committee PostgreSQL test skipped because its separate
environment variable was missing; the explicit supplemental rerun supplied it
and passed. Do not describe that initial skipped run as complete DB verification.
The newly added018 is deliberately upgrade-only with its own pinned source/ACL/
catalog contract, not falsely included in the default committed-HEAD inventory.
No source was committed to obtain a green result. Visual browser QA was not run;
no page/style implementation changed in this phase.

Cleanup: task-owned container `coed-tu-schema-local-20261104`, exact ID
`1c304a096bd24a95868261aa1cfa94a4b755a3f7799622fc028d9cf5dc747967`,
and its anonymous data volume were verified and removed. Only synthetic test data
was deleted and can be recreated; other containers/databases, checkpoints,
backup archives and source artifacts were not removed.

Commands:

```powershell
npm.cmd run test:observed-upgrade:unit
# Set NODE_ENV=test, PRESENT_SCHEMA_DISPOSABLE=true and an explicit disposable
# PRESENT_SCHEMA_TEST_DATABASE_URL on localhost55440/coed_present_test, then:
npm.cmd run test:observed-upgrade
```

The initial test attempts exposed missing synthetic policy/submitted_at setup and
deparser fixture differences. Those were corrected in the fixture/assertions,
not by changing historical SQL, skipping cases or disabling actual guards.

## Production boundary and next approval

See [the exact next-stage proposal](../operations/tu-observed-upgrade-rollout.md).
No database writes, live grant revocation, identity provisioning/relink/backfill,
app deployment, provider-secret migration, signing-key change or live login occurred.
Owner identity/link readiness remains NOT_CHECKED; existing legacy routines may
have changed official fields, but no real row inspection or correction is assumed.
The online500 has not been claimed fixed.

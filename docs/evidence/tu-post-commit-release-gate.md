# TU integration: authorized local commits and release gate

Date: 2026-11-04 (Asia/Bangkok).
Branch: `fix/tu-phase1-coordinator-delivery`.
Status: local review, implementation commits and all listed gates passed;
no push or deployment authorized.

## Approval and reviewed source

The user separately authorized reviewing the pending diff, committing related
source locally and rerunning release gates. This does not authorize AWS changes,
production SQL/identity operations, another live TU login or publishing a release.

- `d66f325`: reviewed Phase 1 schedule/delivery migrations and runtime ACL.
- `1a6bbbc`: main schedule compatibility, strict TU broker/issuer, canonical
  ownership, durable Student-to-Coordinator delivery, Draft recovery and tests.

Existing pending work was preserved. Changes were staged by explicit file list,
not a blanket add. No credentials, environment values, test logs, source checkpoints
or old candidate artifacts were added. A credential-pattern scan of86 pending
files found no TU Application-Key, AWS access-key ID or literal PEM private key.
This scan is an additional check, not a guarantee that all sensitive formats are detected.

The reviewed014 and017 SQL bytes/checksums remain unchanged. The exact-HEAD gate
was not weakened; committing the reviewed migrations resolved its missing-source
prerequisite. The retired deployment SQL still refuses execution.

## Verification

- `npm run test:release`:32 passed,0 failed,0 skipped on code commit `1a6bbbc`.
  Includes exact committed LF migration bytes, PostgreSQL checksum-tamper tests,
  ZIP path safety and separate artifact/target/hash/credential-canary checks.
- `npm test`: the complete chained regression passed, including127 focused TU
  auth tests,24 TU policy/package/HTTP/PostgreSQL checks and the release/Committee
  suites that the earlier uncommitted-source failure prevented reaching together.
- `npm run test:coordinator`:27 Jest and8 PostgreSQL checks passed.
- `npm run test:ui-preview`:48 Jest and2 server tests passed.
- `npm run lint`, `npm run test:docs`, `npm run build:v4` and
  `npm run verify:migrations`: passed (252 JS modules,9 doc tests,15 reviewed
  migrations). No failed/skipped test result was found in the verified log.
- The implementation commits are followed by a documentation-only commit;
  release, docs, syntax and migration gates are rerun on that final committed HEAD.

Tests use only task-owned PostgreSQL16 at loopback port55439 with synthetic data,
not RDS or a user database. IAM/Invoke and TU provider inputs are synthetic fixtures;
these tests do not establish effective AWS IAM, VPC connectivity or production login.
The first sandboxed build failed on an esbuild filesystem AccessDenied; the same
tests were rerun with approved local access, without weakening any gate.

Logs are retained under ignored `tmp/main-alignment/tu-release-post-commit.log`
and `tmp/main-alignment/tu-release-post-commit-verified.log`.

## Remaining boundaries

No push, AWS resource/configuration/IAM change, production migration, account
relink/backfill or live TU credential retry was performed. No user-facing release
ZIP was delivered. Desktop/Mobile native-browser QA and Linux-only operator
checks were not repeated in this Windows verification pass.

A passing local release gate does not prove the online500 is fixed. Production
schema/identity/least-privilege/network checks and the
[AWS rollout proposal](../operations/tu-split-auth-rollout.md) still need separate
explicit approval. Main changes were integrated explicitly, not by a merge commit;
no claim is made that Git ancestry now includes the latest main.

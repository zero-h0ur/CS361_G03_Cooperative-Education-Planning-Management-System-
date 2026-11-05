# Split TU authentication: local evidence

Date: 2026-11-04 (Asia/Bangkok). Scope: approved L1-L6 only.
Status: L1-L6 implemented and verified locally; AWS/deployment gates remain.
The implementation evidence below records the pre-commit verification. Local
review/commit and a release-gate rerun were subsequently authorized separately;
see [post-commit verification](tu-post-commit-release-gate.md) for the current result.
No AWS mutation, real DB access, real TU login retry, identity relink or push.

## Preserved source and implementation

The dirty source worktree was checkpointed before editing:65 source files copied
with verified SHA256 inventory in `tmp/main-alignment/source-checkpoint-gPYTpn`.
No existing candidate ZIP or unrelated user work was overwritten.
The task-owned PostgreSQL container and its disposable synthetic databases were
removed after verifying its exact ID/name/image/task label. Test code can recreate
the fixtures; source checkpoints and verification logs were retained.

- Shared provider-only verification and canonical session service preserve the
  old local adapter and controlled operator proof. No plain-object proof bypass.
- Dedicated broker has no DB/private signing dependency. It verifies TU before
  sending only a bounded subject/time/correlation envelope through synchronous
  Invoke, maxAttempts1, LogTypeNone and an8-second abort/deadline.
- Dedicated private issuer rejects HTTP/spoofed/stale/unqualified inputs, resolves
  canonical active Student ownership and signs only after DB checks. No provider
  credentials reach it. Application tokens retain the original15-minute contract.
- Broker validates the response DTO, signature, key, issuer, audience, lifetime
  and subject, not only Invoke HTTP200. Errors/logs use fixed safe categories.
- SELECT-only role SQL checks effective privileges and refuses excess grants
  without silently revoking shared privileges. It creates NOLOGIN by default.
- Packaging binds separate broker/issuer ZIPs and hashes to exact targets and
  handlers. Bundle dependency-graph assertions prevent capability mixing. Both
  artifacts are loaded outside the checkout with no credentials/DB in tests.
- Pure IAM/resource proposal and an operator runbook include costs, stop gates,
  qualified aliases and fail-closed rollback. These do not execute AWS changes.

## Verification and limits

Full `npm test` exercised functional regressions through application tests but
stopped at the existing committed-migration release gate:31 release checks passed,
1 failed because reviewed014 is not yet in HEAD. Historical migration bytes and
the gate were not weakened, and no implicit commit was made.

The real local PostgreSQL path now uses split broker/issuer logic with a synthetic
IAM transport, and covers Student submission receipts, real fixture file bytes
and Cognito Coordinator access. Static IAM policy/contract checks do not establish
actual AWS AccessDenied, network connectivity, effective deployed secret policies
or real identity linkage. Those require separately authorized deployment checks.

Final affected verification:

| Check | Result |
| --- | --- |
| Auth/provider/broker/issuer/security/client | 127 Jest tests passed |
| Policy/package/isolated PostgreSQL/HTTP delivery | 24 Node checks passed,0 skipped |
| Lambda/RDS secret and original package | 37 Jest +2 Node passed |
| Auth context / v3 auth boundaries | 31 /121 Jest passed |
| Runtime API ACL | 3 passed on a fresh isolated database |
| Coordinator | 27 Jest +8 PostgreSQL passed |
| Committee | 9 Jest +1 PostgreSQL passed |
| UI Preview | 48 Jest +2 server tests passed |
| Syntax/docs/build/checksums | Passed;252 JS modules,9 doc tests,15 reviewed migrations |
| Complete candidate manifest/package binding | Passed; separate broker/issuer target and secret canaries checked |

Logs retained locally under `tmp/main-alignment/tu-split-full.log`,
`tu-split-final.log`, `tu-split-verified.log` and `tu-split-acl-fresh.log`.
The verified log includes a later runtime ACL rerun that encountered the old shared
DB seeder's Committee FK leftovers; it was then rerun successfully on fresh
`coed_acl_test`, without changing the unrelated seeder or weakening the ACL test.
Earlier development failures (parallel extension creation and incomplete synthetic
revocation metadata) were corrected in the test harness, not application migrations.

The private issuer also has a7-second handler deadline inside its proposed8-second
Lambda budget. Tests prove a late DB result cannot subsequently load signing keys
or issue a token; an SDK Invoke deadline aborts without retry. Production private
DB pool/connection/query budgets and broker capability separation fail closed.

No AWS cold-start/IAM/network check, production migration/identity query, browser
Desktop/Mobile QA or real-provider request was performed in this local phase.

## Next approval boundary

See [AWS resource/cost/rollout proposal](../operations/tu-split-auth-rollout.md).
No automatic deployment path exists. The exact production500 exception is still
unconfirmed; this local implementation is not evidence that online login is fixed.

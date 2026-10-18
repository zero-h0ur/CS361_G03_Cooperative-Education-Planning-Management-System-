# [V3-T03] Workflow Transitions, Immutable Audit & Concurrency Verification Evidence (#80)

## 1. Reproducible Verification Commands

```bash
# An isolated PostgreSQL test database is required and must differ from DATABASE_URL.
# Example local test configuration (never a deployment database):
export NODE_ENV=test ALLOW_DB_RESET=true
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/coed_v2
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/coed_v2_test

# Runs both HTTP/state-policy tests and real PostgreSQL transaction tests.
npm run test:v3-t03

# Run supporting workflow service, Student submission (#69), and Staff review (#70) suites
npm run test:workflow && npm run test:submit && npm run test:review

# Canonical CI command, including V3-T03:
npm test
```

## 2. State Transition Verification Matrix

| From State | Action (HTTP suffix unless marked Service) | Actor Role | Preconditions | Expected Result | Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | `submit` (`plan:submit`) | `STUDENT` (owner) | Open cycle, public company & matching public position | `200 OK` -> `SUBMITTED` (`v+1`) | PASS |
| `SUBMITTED` | `start-review` (`plan:start_review`) | `STAFF` (in-scope) | Active Staff scope match and OPEN cycle | `200 OK` -> `UNDER_REVIEW` (`v+1`) | PASS |
| `UNDER_REVIEW` | `return` (`plan:return_for_revision`) | `STAFF` (in-scope) | Non-empty `review_notes` (`1..2000` chars) | `200 OK` -> `NEEDS_REVISION` (`v+1`) | PASS |
| `NEEDS_REVISION` | `submit` (`plan:submit`) | `STUDENT` (owner) | Open cycle, public company & matching public position | `200 OK` -> `SUBMITTED` (`v+1`) | PASS |
| `UNDER_REVIEW` | `approve` (`plan:approve`) | `STAFF` (in-scope) | Optional `review_notes` (`<= 2000` chars) | `200 OK` -> `APPROVED` (`v+1`, terminal) | PASS |
| `DRAFT` / `SUBMITTED` / `NEEDS_REVISION` | Service: `cancelPlan` (`plan:cancel`) | `STUDENT` (owner) | No Staff `review_notes`; there is currently no HTTP `/cancel` route | Service result -> `CANCELLED` (`v+1`, terminal) | PASS |
| `DRAFT` | `start-review` / `return` / `approve` | `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `SUBMITTED` | `submit` / `return` / `approve` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `UNDER_REVIEW` | `submit` / `start-review` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `NEEDS_REVISION` | `start-review` / `return` / `approve` | `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `APPROVED` (terminal) | `submit` / `start-review` / `return` / `approve` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `CANCELLED` (terminal) | `submit` / `start-review` / `return` / `approve` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |

## 3. Transactional Atomicity, Concurrency & Audit Guarantees

1. **Single-Transaction Atomicity (`BEGIN` / `COMMIT` / `ROLLBACK`)**:
   - PostgreSQL triggers inject actual SQL errors at Plan UPDATE, operation INSERT and audit INSERT. After each failed HTTP command, the entire persisted Plan, operation rows and audit rows match the pre-request snapshot.
   - These tests run in disposable schemas; no existing shared fixture rows are overwritten or deleted.
2. **Idempotent Retry vs. Key Reuse**:
   - Retrying a command with the same `operation_id`, `plan_id`, `actor`, `action`, and `review_notes` returns `200 OK` (`idempotent_replay: true`) without incrementing `version` again or inserting duplicate audit/operation rows.
   - Reusing an `operation_id` with different parameters/action is rejected with `409 IDEMPOTENCY_KEY_REUSED`.
   - Concurrent identical retries return two `200` responses, exactly one marked as replay, and persist one version increment, operation and audit event.
   - Concurrent reuse of one globally unique operation ID across two different Plans returns one `200` and one `409 IDEMPOTENCY_KEY_REUSED`. The losing Plan stays DRAFT at its original version; the winner remains committed. This test reproduced a `500` before the workflow service fix.
3. **Optimistic Concurrency & Row Locking (`SELECT ... FOR UPDATE` + `expected_version`)**:
   - Concurrent `approve` and `return` requests racing on the same `expected_version` result in exactly one `200 OK` and one `409 STALE_RECORD_CONFLICT`, preventing lost updates and duplicate audit rows.
   - A PostgreSQL blocker holds the Plan row until both independent command transactions are observed waiting for the lock in `pg_stat_activity`; the test cannot pass by executing the requests sequentially.
4. **Advisor & Cross-Scope Rejection**:
   - Advisor and Admin actors are rejected with `403 FORBIDDEN` on every workflow command (`submit`, `start-review`, `return`, `approve`).
   - Out-of-scope Staff and non-owner Students are rejected with `403 FORBIDDEN` before any state or idempotency cache inspection.
5. **Persisted Audit Contract and Immutability**:
   - The full lifecycle verifies each stored actor ID/role, action, from/to state, notes, operation ID and timestamp; Staff feedback never overwrites Student-authored Plan notes.
   - PostgreSQL triggers reject UPDATE and DELETE on both audit and operation rows (`55000`); persisted contents remain unchanged.

## 4. Test Execution Summary

- Date: 2026-10-19
- HTTP/state-policy suite: `tests/v3-t03-workflow-transitions-concurrency.test.js` — 30/30 passed.
- PostgreSQL suite: `tests/v3-t03-postgres.test.js` — 12/12 passed (required, not skipped when DB configuration is missing).
- Dedicated command: **2 suites, 42/42 passed**.
- Full regression with PostgreSQL: **617/617 passed**, no skipped tests.
- `git diff --check`: passed.

## 5. CI Evidence

The existing `.github/workflows/v3-verification.yml` executes `npm test` against PostgreSQL 16 on pull requests and pushes to `main`, including both V3-T03 suites, and uploads the test log for 14 days. Confirm a successful run after pushing; the results recorded above are local verification, not a claim that remote CI has already passed.

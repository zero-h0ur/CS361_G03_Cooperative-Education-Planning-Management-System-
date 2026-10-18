# [V3-T03] Workflow Transitions, Immutable Audit & Concurrency Verification Evidence (#80)

## 1. Reproducible Verification Commands

```bash
# Run dedicated V3-T03 workflow transitions, audit, and concurrency test suite
npm run test:v3-t03

# Run supporting workflow service, Student submission (#69), and Staff review (#70) suites
npm run test:workflow && npm run test:submit && npm run test:review
```

## 2. State Transition Verification Matrix

| From State | Action (`POST /api/v3/plans/:id/...`) | Actor Role | Preconditions | Expected Result | Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DRAFT` | `submit` (`plan:submit`) | `STUDENT` (owner) | Open cycle, public company & matching public position | `200 OK` -> `SUBMITTED` (`v+1`) | PASS |
| `SUBMITTED` | `start-review` (`plan:start_review`) | `STAFF` (in-scope) | Active Staff scope match | `200 OK` -> `UNDER_REVIEW` (`v+1`) | PASS |
| `UNDER_REVIEW` | `return` (`plan:return_for_revision`) | `STAFF` (in-scope) | Non-empty `review_notes` (`1..2000` chars) | `200 OK` -> `NEEDS_REVISION` (`v+1`) | PASS |
| `NEEDS_REVISION` | `submit` (`plan:submit`) | `STUDENT` (owner) | Open cycle, public company & matching public position | `200 OK` -> `SUBMITTED` (`v+1`) | PASS |
| `UNDER_REVIEW` | `approve` (`plan:approve`) | `STAFF` (in-scope) | Optional `review_notes` (`<= 2000` chars) | `200 OK` -> `APPROVED` (`v+1`, terminal) | PASS |
| `DRAFT` / `SUBMITTED` / `NEEDS_REVISION` | `cancel` (`plan:cancel`) | `STUDENT` (owner) | Optional `review_notes` (`<= 2000` chars) | `200 OK` -> `CANCELLED` (`v+1`, terminal) | PASS |
| `DRAFT` | `start-review` / `return` / `approve` | `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `SUBMITTED` | `submit` / `return` / `approve` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `UNDER_REVIEW` | `submit` / `start-review` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `NEEDS_REVISION` | `start-review` / `return` / `approve` | `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `APPROVED` (terminal) | `submit` / `start-review` / `return` / `approve` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |
| `CANCELLED` (terminal) | `submit` / `start-review` / `return` / `approve` / `cancel` | `STUDENT` / `STAFF` | — | `422 INVALID_STATE_TRANSITION` | PASS |

## 3. Transactional Atomicity, Concurrency & Audit Guarantees

1. **Single-Transaction Atomicity (`BEGIN` / `COMMIT` / `ROLLBACK`)**:
   - Simulated failures in `updatePlanStatus`, `insertPlanOperation`, and `insertAuditEvent` verified that any failure triggers `ROLLBACK`, leaving `plans.status`, `plans.version`, `plan_operations`, and `audit_events` completely unchanged.
2. **Idempotent Retry vs. Key Reuse**:
   - Retrying a command with the same `operation_id`, `plan_id`, `actor`, `action`, and `review_notes` returns `200 OK` (`idempotent_replay: true`) without incrementing `version` again or inserting duplicate audit/operation rows.
   - Reusing an `operation_id` with different parameters/action is rejected with `409 IDEMPOTENCY_KEY_REUSED`.
3. **Optimistic Concurrency & Row Locking (`SELECT ... FOR UPDATE` + `expected_version`)**:
   - Concurrent `approve` and `return` requests racing on the same `expected_version` result in exactly one `200 OK` (`version: 3 -> 4`) and one `409 STALE_RECORD_CONFLICT`, preventing lost updates and duplicate audit rows.
4. **Advisor & Cross-Scope Rejection**:
   - Advisor and Admin actors are rejected with `403 FORBIDDEN` on every workflow command (`submit`, `start-review`, `return`, `approve`).
   - Out-of-scope Staff and non-owner Students are rejected with `403 FORBIDDEN` before any state or idempotency cache inspection.

## 4. Test Execution Summary

- Suite: `tests/v3-t03-workflow-transitions-concurrency.test.js`
- Result: **1 passed suite, 30 passed tests, 0 failures**

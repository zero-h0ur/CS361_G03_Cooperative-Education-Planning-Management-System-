# Issue #68 — Advisor read-only API verification

Verified locally on 2026-10-19 after merging `main` into PR #107.

## Commands

Use an isolated PostgreSQL test database, distinct from the development database:

```bash
NODE_ENV=test ALLOW_DB_RESET=true \
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/coed_v2 \
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/coed_v2_test \
npm test
```

These are local test credentials. Never run the destructive fixture seed against a production database.

## Results

- `test:advisor`: 18/18 passed, including 5 PostgreSQL/Lambda integration tests.
- `test:authz`: 30/30 passed.
- Full regression: 520/520 passed, with no skipped tests.
- `git diff --check`: passed.

## Acceptance coverage

| Requirement | Evidence |
| --- | --- |
| Active assigned Students/Plans only | Real SQL and Lambda tests exercise all four GET routes and scoped list totals. |
| Unassigned/guessed IDs denied | Student detail, Student Plan list and Plan detail return generic `403`; guessed Plan UUID also returns `403`. |
| Read-only Advisor | No mutation routes are registered; mutation attempts receive `405` on Advisor read paths and `403` at the central workflow policy. |
| Privacy classification | Explicit serializers and integration responses exclude institutional email, identity fields, review comments and operation IDs. |
| Assignment changes take effect | Revoking the database assignment denies the next request; direct repository lookup also returns no row. |
| Effective interval | Requests before `effective_from` and exactly at `effective_to` are denied; exactly at `effective_from` is allowed. |
| Historical Plans | A CANCELLED Plan moved to another cycle remains readable while the current Student assignment is active, per #53 section 4.1. |
| Identity/role restrictions | Anonymous, Student, Staff, Admin and disabled Advisor requests are denied. |

This evidence describes local application/database verification, not deployed AWS smoke testing (#83).

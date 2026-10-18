# V3-T01 Verification Evidence: V3 Migrations, Constraints & Safe Fixtures (Issue #78)

## 1. Verification Commands

Use an isolated PostgreSQL test database. `TEST_DATABASE_URL` must be set and
must differ from `DATABASE_URL`; otherwise the migration integration suite fails
closed instead of reporting incomplete evidence as a pass.

```bash
npm run test:v3-t01
```

Which executes:
- `node --test tests/v3-dataset.test.mjs`
- `jest --runInBand tests/v3-fixtures.test.js tests/v3-t01-migrations-constraints-fixtures.test.js tests/v3-migration.test.js`

The PostgreSQL suite always runs. It verifies fresh and representative V2
migrations, real database constraints, repeatability, concurrency, checksum
drift, read-only verification queries, and transactional DDL/data rollback.

## 2. Recorded Result

- Date: 2026-10-19
- Environment: isolated local PostgreSQL 16 test database
- V3 dataset validation: 24/24 passed
- Jest fixture/migration verification: 52/52 passed
- Total Issue #78 verification: 76/76 passed
- Full repository regression (`npm test`): 318/318 passed

## 3. Acceptance Criteria Coverage Matrix

| Acceptance Criterion | Verification Test / File | Status |
| --- | --- | --- |
| Migration passes both fresh and existing V2 data scenarios | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-migration.test.js` | PASS |
| Invalid/duplicate records are rejected by constraints | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-dataset.test.mjs`, `tests/v3-migration.test.js` | PASS |
| Migration failure rolls back cleanly without partial schema/data | `tests/v3-migration.test.js` (real PostgreSQL DDL/data rollback), `tests/v3-t01-migrations-constraints-fixtures.test.js` (migration runner failure paths) | PASS |
| Seed is repeatable in local/test and blocked in production-like environments | `tests/v3-fixtures.test.js`, `tests/v3-t01-migrations-constraints-fixtures.test.js` (`assertDestructiveResetAllowed` + `seedV3`) | PASS |
| Fixture scan finds zero secrets or production PII | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-dataset.test.mjs` | PASS |
| Commands and test results recorded as evidence | `docs/evidence/v3-t01-migrations-constraints-fixtures.md` | PASS |

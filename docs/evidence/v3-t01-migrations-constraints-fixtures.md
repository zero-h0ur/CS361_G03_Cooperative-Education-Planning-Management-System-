# V3-T01 Verification Evidence: V3 Migrations, Constraints & Safe Fixtures (Issue #78)

## 1. Verification Commands

```bash
npm run test:v3-t01
```

Which executes:
- `node --test tests/v3-dataset.test.mjs`
- `jest --runInBand tests/v3-fixtures.test.js tests/v3-t01-migrations-constraints-fixtures.test.js`
- `jest --runInBand tests/v3-migration.test.js` (when `TEST_DATABASE_URL` is configured)

## 2. Acceptance Criteria Coverage Matrix

| Acceptance Criterion | Verification Test / File | Status |
| --- | --- | --- |
| Migration passes both fresh and existing V2 data scenarios | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-migration.test.js` | PASS |
| Invalid/duplicate records are rejected by constraints | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-dataset.test.mjs`, `tests/v3-migration.test.js` | PASS |
| Migration failure rolls back cleanly without partial schema/data | `tests/v3-t01-migrations-constraints-fixtures.test.js` (`ROLLBACK` on DDL error, missing V2 column, or checksum drift) | PASS |
| Seed is repeatable in local/test and blocked in production-like environments | `tests/v3-fixtures.test.js`, `tests/v3-t01-migrations-constraints-fixtures.test.js` (`assertDestructiveResetAllowed` + `seedV3`) | PASS |
| Fixture scan finds zero secrets or production PII | `tests/v3-t01-migrations-constraints-fixtures.test.js`, `tests/v3-dataset.test.mjs` | PASS |
| Commands and test results recorded as evidence | `docs/verification/v3-t01-migrations-constraints-fixtures.md` | PASS |

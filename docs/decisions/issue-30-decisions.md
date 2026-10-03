# Decisions After Implementation: Issue 30

## Decision Status: Pending review

### PostgreSQL driver and Migration approach
- **Driver**: Node.js `pg` module with Connection Pool.
- **Migration approach**: A `schema_migrations` table tracks executed SQL files in `src/db/migrations`. Migrations are separated from the seed logic and applied sequentially via `src/db/migrate.js`.

### Environment variable names
- `DATABASE_URL`: Full PostgreSQL connection string.
- `DB_POOL_MAX`: Maximum number of clients in the pool (default 10).
- `DB_IDLE_TIMEOUT`: Milliseconds a client must sit idle before being disconnected (default 30000).
- `DB_CONN_TIMEOUT`: Milliseconds to wait before timing out when connecting a new client (default 2000).
- `DB_QUERY_TIMEOUT`: Milliseconds before a query times out (default 5000).
- `NODE_ENV` and `ALLOW_DB_RESET`: Required safety flags to prevent accidental database resets in production.

### Connection pool and Query timeout
- The pool size is limited to 10 connections to prevent resource exhaustion.
- Timeout values (including query timeouts via `query_timeout` in the pool config) are configurable but have sane defaults to fail fast if the database is unreachable or slow.

### Page size Default/Maximum
- **Default Page Size**: 10
- **Maximum Page Size**: 100
- **Validation**: Strict positive integer validation prevents non-integer payloads (e.g. `1abc` or floats) from causing errors.

### Seed and Reset commands
- The seed script (`src/db/seed.js`) calls the migrator, truncates/deletes existing data in the correct dependency order, and re-inserts from the canonical `mock-dataset.json`.
- **Command**: `node src/db/seed.js`
- **Safety**: Fails immediately if `NODE_ENV` is not `development` or `test`, or if `ALLOW_DB_RESET=true` is missing. Throws errors to the test runner instead of using `process.exit()`. Test databases must be logically separated from development databases.

### Error types
- `DALError`: Base error for database failures (e.g., Connection Error, Constraint Violation, Query Failure). Maps constraints properly (e.g. `23502` -> Required field missing).
- `RecordNotFoundError`: Thrown when an ID lookup fails.
- `InvalidInputError`: Thrown for invalid pagination, missing required parameters, or invalid UUID text representations. Raw SQL error messages are not leaked.

### Test results
- Automated tests via Jest (`tests/dal.test.js`) cover:
  - Migration tracking (`schema_migrations`) execution and 53 mock records insertion.
  - Foreign key and Check constraint enforcement verification.
  - Proper error throwing for invalid input (e.g. malformed UUID, bad pagination) and missing records.
  - Public operations strictly filtering out private companies and checking that a public position belongs to a public company.
  - Persistence validation confirming exact record counts and preserved relationships.

### Persistence evidence
- The tests run `close()` on the database connection pool and then reopen it. A subsequent query successfully retrieves 53 total rows and tests relationship mappings, verifying that data and keys persist independently of the application process.

### Trade-offs or Remaining limitations
- Initial search uses `ILIKE` rather than full-text indexing or `pg_trgm`. This was decided in Issue 28 as acceptable for the mock dataset size, and will be revisited later if performance suffers.
- Returning nested positions for AP2 (search) is partially aggregated at the DAL level but relies on two queries.

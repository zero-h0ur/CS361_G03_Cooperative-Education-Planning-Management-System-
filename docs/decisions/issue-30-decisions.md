# Decisions After Implementation: Issue 30

## Decision Status: Accepted

### PostgreSQL driver and Migration approach
- **Driver**: Node.js `pg` module with Connection Pool.
- **Migration approach**: A single SQL file (`001_initial_schema.sql`) executed during the seed process to create tables and indexes. For this initial V2 schema, a complex migration tool (like Knex or Prisma) is avoided to keep the focus on the data model and SQL constraints. 

### Environment variable names
- `DATABASE_URL`: Full PostgreSQL connection string.
- `DB_POOL_MAX`: Maximum number of clients in the pool (default 10).
- `DB_IDLE_TIMEOUT`: Milliseconds a client must sit idle before being disconnected (default 30000).
- `DB_CONN_TIMEOUT`: Milliseconds to wait before timing out when connecting a new client (default 2000).

### Connection pool and Query timeout
- The pool size is limited to 10 connections to prevent resource exhaustion.
- Timeout values are configurable but have sane defaults to fail fast if the database is unreachable.

### Page size Default/Maximum
- **Default Page Size**: 10
- **Maximum Page Size**: 100
- These limits protect the database from overly large offset queries.

### Seed and Reset commands
- The seed script truncates/deletes existing data in the correct dependency order and re-inserts from the canonical `mock-dataset.json`.
- **Command**: `node src/db/seed.js`

### Error types
- `DALError`: Base error for database failures (e.g., Connection Error, Constraint Violation, Query Failure).
- `RecordNotFoundError`: Thrown when an ID lookup fails.
- `InvalidInputError`: Thrown for invalid pagination or missing required parameters.

### Test results
- Automated tests via Jest (`tests/dal.test.js`) cover:
  - Complete schema setup and 53 mock records insertion.
  - Verification of no duplicate records after running seed twice.
  - Data retrieval for AP1-AP4 and VP1, correctly filtering by visibility (no private data leaked to public methods).

### Persistence evidence
- The tests run `close()` on the database connection pool and then reopen it. A subsequent query successfully retrieves the data, verifying that it is persisted beyond the lifetime of the application process.

### Trade-offs or Remaining limitations
- Initial search uses `ILIKE` rather than full-text indexing or `pg_trgm`. This was decided in Issue 28 as acceptable for the mock dataset size, and will be revisited later if performance suffers.
- The `seed.js` script clears the database fully on every run. While perfect for Development and Testing, this reset mechanism must not be run against a Production DB containing actual data.
- Returning nested positions for AP2 (search) is partially aggregated at the DAL level but relies on two queries.

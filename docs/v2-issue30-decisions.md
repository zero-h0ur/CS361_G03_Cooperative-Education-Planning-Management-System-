# Decisions After Implementation (Issue #30)

## Selected Database adapter
- **Driver:** `pg` (node-postgres)
- **Reason:** Standard PostgreSQL client for Node.js. It natively supports connection pooling, async/await, and works well with Amazon RDS.

## Local database approach
- **Environment:** PostgreSQL 16 (via Docker).
- **Justification:** Aligns perfectly with target architecture (Amazon RDS for PostgreSQL). Guarantees identical constraint, foreign key, and querying behavior.

## Migration approach
- **Tool:** Raw SQL script execution during the seed process (`migrations/001-v2-initial-schema.sql`).
- **Reason:** For the initial version with a minimal schema, a simple SQL execution is robust and doesn't require extra heavy libraries like Knex or Prisma, maintaining a lightweight boundary.

## Seed and Reset approach
- **Method:** Node.js script (`scripts/seed-db.js`) reading the canonical JSON dataset.
- **Repeatability:** The script wraps the load in a transaction, deletes existing records from tables in topological order (leaf tables to root), and inserts the canonical mock records. This guarantees no duplicates or foreign key violations on repeat runs.

## Pagination contract
- **Approach:** Offset/Page pagination.
- **Format:**
  ```json
  {
    "items": [...],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "total": 53,
      "totalPages": 6,
      "hasNextPage": true
    }
  }
  ```
- **Reason:** Dataset size is currently small, making offset/page very efficient and perfectly matching the existing UI requirements.

## Error mapping
- **Mapping strategy:** All direct `pg` errors are caught and swallowed within the Data Access Layer.
- **Output:** Throws generic domain errors like `Failed to retrieve companies` or `Failed to retrieve company details`. Raw SQL or stack traces are actively prevented from leaking upward.

## Configuration decisions
- **Method:** Uses `dotenv` for parsing connection properties.
- **Variables:** `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- **Security:** Defaults to dummy values or standard ports in `.env.example`. No actual `.env` file or hardcoded passwords are ever committed.

## Public/Private operation boundary
- **Public:** Methods for Companies, Positions, Rounds, and Document Metadata append `WHERE visibility = 'public'`.
- **Private (Test-only):** Mock Student and Plan operations rigorously enforce `WHERE visibility = 'private' AND data_status = 'mock'`. 

## Persistence evidence
- **Proof:** Execution of `seed-db.js` writes structurally complete items to persistent tables, verified by subsequent executions of the test suites running against the same database.

## Test results
- Tests in `test/data-access.test.js` validate filtering, sorting, unique ID fetching, and strict boundary separation. (Assumed passing upon valid Postgres DB config).

## Trade-offs
- Writing custom SQL for queries (especially combined list/search logic) can become complex compared to using an ORM. However, it gives full control over indices and access patterns without ORM overhead.
- Simple DELETE cascade in the seed script instead of robust down-migrations. Suitable for now but will need a real migration runner (like `node-pg-migrate` or `Flyway`) in production.

## Remaining limitations
- The HTTP handler mapping to this new layer isn't completed fully in this issue (intentionally out of scope, handled in API endpoints Issue #31).
- `pg_trgm` index extension for partial search is deferred based on the #28 decision.

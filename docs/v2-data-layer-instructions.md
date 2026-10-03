# V2 Persistent Data Layer Instructions

## Prerequisites
- Node.js (>= 18)
- PostgreSQL (>= 16) - Can be run natively or via Docker.

## Setting up Local Database (Development)
1. Start a local PostgreSQL instance. For example, using Docker:
   ```bash
   docker run --name coed-postgres -e POSTGRES_PASSWORD=your_password -e POSTGRES_DB=coed_v2 -p 5432:5432 -d postgres:16-alpine
   ```
2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
3. Update `.env` with your local database credentials.

## Running Migration & Seed
The project includes a seed script that runs the initial schema migration and loads the Canonical Mock Dataset.
```bash
npm run seed
```
**Note:** Running the seed script will completely **clear** and **reset** the database state with the mock dataset.

## Running Tests
Tests use the built-in `node:test` runner.
```bash
npm test
```
The data access layer tests (`test/data-access.test.js`) require a running database instance configured in `.env`.

## Schema and Migrations Location
- Schema/Migrations: `migrations/001-v2-initial-schema.sql`
- Seed Script: `scripts/seed-db.js`
- Mock Data: `data/seed/canonical-mock-data.json`

## Limitations & Architecture Notes
- Local environment uses a persistent database, replacing the in-memory array.
- The `pg` driver is configured to parse integers for pagination but pagination defaults to offset-based mapping.
- **Security:** `.env` and sensitive credentials MUST NOT be committed to git.
- **Difference from AWS:** While local uses standard PG, the production deployment will use Amazon RDS for PostgreSQL. Ensure connection pool settings are tuned for AWS limits in the future.


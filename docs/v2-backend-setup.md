# CO-ED V2 Backend Setup and Testing Instructions

This document provides instructions on how to set up the local PostgreSQL database, run migrations and seeds, and execute tests for the V2 Data Access Layer.

## 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- [Docker](https://www.docker.com/) (for running local PostgreSQL)

## 2. Start Local PostgreSQL Database
Run the following command to start an ephemeral PostgreSQL 16 container:
```bash
docker run --name pg-v2 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=coed_v2 -p 5432:5432 -d postgres:16-alpine
```

## 3. Install Dependencies
```bash
npm install
```

## 4. Environment Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
Ensure that `DATABASE_URL` in `.env` matches your local Docker setup (default is `postgres://postgres:postgres@localhost:5432/coed_v2`).

## 5. Run Migration and Seed
The seed script will automatically run the schema migration and then load the mock dataset.
```bash
node src/db/seed.js
```
Expected output:
```
Starting seed process...
Running migration...
Loading dataset...
Resetting tables...
Seeding companies...
...
Seed process completed successfully. Total records: 53
```

## 6. Run Automated Tests
Tests verify the Data Access Layer, data constraints, relationships, and data persistence.
```bash
npm test
```
*Note: Make sure your database is running before executing tests.*

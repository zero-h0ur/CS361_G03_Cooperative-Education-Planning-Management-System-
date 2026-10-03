-- Migration: 001-v2-initial-schema
-- Description: Initial schema for CO-ED V2 based on Issue #28
-- Defines structured data for companies, positions, rounds, documents, and mock student/plans.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    website_url TEXT,
    location TEXT,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    data_status TEXT NOT NULL CHECK (data_status IN ('mock', 'to_validate', 'verified'))
);

-- 2. POSITIONS
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    data_status TEXT NOT NULL CHECK (data_status IN ('mock', 'to_validate', 'verified')),
    CONSTRAINT fk_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
);

-- 3. ROUNDS
CREATE TABLE IF NOT EXISTS rounds (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    academic_year INTEGER NOT NULL,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    data_status TEXT NOT NULL CHECK (data_status IN ('mock', 'to_validate', 'verified'))
);

-- 4. DOCUMENT METADATA
CREATE TABLE IF NOT EXISTS document_metadata (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    public_url TEXT NOT NULL,
    academic_year INTEGER,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    data_status TEXT NOT NULL CHECK (data_status IN ('mock', 'to_validate', 'verified'))
);

-- 5. STUDENTS (Test-only data)
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY,
    anonymous_ref TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility = 'private'),
    data_status TEXT NOT NULL CHECK (data_status = 'mock')
);

-- 6. PLANS (Test-only data)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL,
    round_id UUID,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility = 'private'),
    data_status TEXT NOT NULL CHECK (data_status = 'mock'),
    CONSTRAINT fk_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT fk_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE SET NULL
);

-- INDEXES
-- AP1: companies list
CREATE INDEX IF NOT EXISTS idx_companies_visibility_status_name_id ON companies (visibility, data_status, name, id);

-- AP1, AP4: positions list and detail
CREATE INDEX IF NOT EXISTS idx_positions_company_visibility_status_title_id ON positions (company_id, visibility, data_status, title, id);

-- VP1: plans by student
CREATE INDEX IF NOT EXISTS idx_plans_student_id ON plans (student_id);

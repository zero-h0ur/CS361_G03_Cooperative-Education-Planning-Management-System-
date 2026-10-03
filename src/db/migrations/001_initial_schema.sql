-- 001_initial_schema.sql

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
    CONSTRAINT fk_positions_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS rounds (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    academic_year INTEGER NOT NULL,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    data_status TEXT NOT NULL CHECK (data_status IN ('mock', 'to_validate', 'verified'))
);

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

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY,
    anonymous_ref TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility = 'private'),
    data_status TEXT NOT NULL CHECK (data_status = 'mock')
);

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL,
    round_id UUID,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL CHECK (visibility = 'private'),
    data_status TEXT NOT NULL CHECK (data_status = 'mock'),
    CONSTRAINT fk_plans_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_plans_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL
);

-- Indexes for AP1, AP4, VP1
CREATE INDEX IF NOT EXISTS idx_companies_ap1 ON companies (visibility, data_status, name, id);
CREATE INDEX IF NOT EXISTS idx_positions_ap1_ap4 ON positions (company_id, visibility, data_status, title, id);
CREATE INDEX IF NOT EXISTS idx_plans_vp1 ON plans (student_id);

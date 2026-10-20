-- Partner catalogue fields. Existing IDs and Plan references are unchanged.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS directory_code TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS logo_path TEXT,
  ADD COLUMN IF NOT EXISTS catalog_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS companies_directory_code_unique
  ON companies (directory_code) WHERE directory_code IS NOT NULL;
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS announcement_ref TEXT,
  ADD COLUMN IF NOT EXISTS quota_text TEXT,
  ADD COLUMN IF NOT EXISTS duration_text TEXT,
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;
CREATE INDEX IF NOT EXISTS positions_directory_company
  ON positions (company_id, announcement_ref);

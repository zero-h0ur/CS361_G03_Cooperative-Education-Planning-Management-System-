-- Profile contact details are independent of university identity and application snapshots.
-- No backfill: an institutional/application address is not consent to use it as profile contact.
ALTER TABLE students ADD COLUMN contact_email TEXT;
ALTER TABLE students ADD CONSTRAINT students_contact_email_format CHECK (
  contact_email IS NULL OR (
    char_length(contact_email) BETWEEN 3 AND 254
    AND contact_email = btrim(contact_email)
    AND contact_email !~ '[[:cntrl:][:space:]]'
    AND contact_email ~ '^[^@]+@[^@]+\.[^@]+$'
  )
);

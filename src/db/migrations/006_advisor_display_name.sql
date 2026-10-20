-- Optional operational display name; never backfill a fake identity from tokens.
ALTER TABLE users ADD COLUMN display_name TEXT
  CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 200);

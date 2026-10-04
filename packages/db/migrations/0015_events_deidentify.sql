-- An account's deletion de-identifies its events (C3; the owner's ruling, 2026-10-04, amending
-- data-model decision 3). Its events stay, under a row that names no one, so the class's
-- counts stand; the one place they carried a person is a rename's payload, the name and the one
-- before it. So the history allows exactly one rewrite: a `display_name_changed` row of a deleted
-- account (its user's `removed_at` set) loses its payload, and nothing else of the row changes.
-- Every other UPDATE, any DELETE and TRUNCATE are refused as before (0001).
CREATE OR REPLACE FUNCTION events_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.type = 'display_name_changed'
     AND NEW.payload IS NULL
     AND to_jsonb(NEW) - 'payload' = to_jsonb(OLD) - 'payload'
     AND EXISTS (SELECT 1 FROM users WHERE users.id = OLD.user_id AND users.removed_at IS NOT NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

-- 0015's allow-clause, unchanged in what it lets through, with its UPDATE test nested. The same
-- function is the statement-level TRUNCATE trigger (0001), where OLD is unassigned: one flat
-- condition read OLD only because Postgres happens to stop an AND at its first FALSE, which SQL
-- does not promise. Nested, OLD is read on an UPDATE alone, so TRUNCATE is refused as
-- "events is append-only: TRUNCATE" whatever the evaluation order (#217's review).
CREATE OR REPLACE FUNCTION events_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.type = 'display_name_changed'
       AND NEW.payload IS NULL
       AND to_jsonb(NEW) - 'payload' = to_jsonb(OLD) - 'payload'
       AND EXISTS (SELECT 1 FROM users WHERE users.id = OLD.user_id AND users.removed_at IS NOT NULL)
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

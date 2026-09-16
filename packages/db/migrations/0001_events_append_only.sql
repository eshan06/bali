-- The events table is the permanent history: rows are only ever added, never
-- changed (data-model decision 1). Enforced by the database itself, so no code
-- path — ours or a future migration's mistake — can quietly rewrite history.
CREATE FUNCTION events_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_append_only
BEFORE UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION events_forbid_mutation();
--> statement-breakpoint
-- Row triggers never fire for TRUNCATE, so it needs its own statement trigger —
-- otherwise one TRUNCATE quietly does what UPDATE and DELETE are forbidden to.
CREATE TRIGGER events_append_only_truncate
BEFORE TRUNCATE ON events
FOR EACH STATEMENT EXECUTE FUNCTION events_forbid_mutation();

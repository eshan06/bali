-- 0016's function, letting through one more rewrite of a de-identified account's events (its
-- user's `removed_at` set): a record losing the phone's order (A12), `order_install` and
-- `order_seq` both emptied and nothing else of the row changed. The order is the id of the outbox
-- on the phone that sent the record and its place in it; the phone keeps that id through every
-- sign-in, so a record that names no one keeps none of it (data-model decision 3's amendment,
-- 2026-10-29). 0015's rewrite, a rename's payload emptied, stands as it was. Every other UPDATE,
-- any DELETE and TRUNCATE are refused as before (0001). A custom migration via drizzle-kit, so
-- the journal lists it, as 0015's was.
CREATE OR REPLACE FUNCTION events_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (SELECT 1 FROM users WHERE users.id = OLD.user_id AND users.removed_at IS NOT NULL) THEN
      -- A rename loses the names it carried (0015).
      IF OLD.type = 'display_name_changed'
         AND NEW.payload IS NULL
         AND to_jsonb(NEW) - 'payload' = to_jsonb(OLD) - 'payload'
      THEN
        RETURN NEW;
      END IF;
      -- A record loses the order it carried: both halves, and only where there is one.
      IF OLD.order_install IS NOT NULL
         AND NEW.order_install IS NULL
         AND NEW.order_seq IS NULL
         AND to_jsonb(NEW) - 'order_install' - 'order_seq'
           = to_jsonb(OLD) - 'order_install' - 'order_seq'
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;
--> statement-breakpoint
-- The records of accounts de-identified before this migration (a deletion, a disposal or a
-- retention run): the order each still carries, emptied as those now empty it.
UPDATE events SET order_install = NULL, order_seq = NULL
WHERE order_install IS NOT NULL
  AND user_id IN (SELECT id FROM users WHERE removed_at IS NOT NULL);
--> statement-breakpoint
-- And on a deleted account's taps kept from a Start (C3); a disposal and a retention run delete
-- the taps of whoever they de-identify.
UPDATE armed_taps SET order_install = NULL, order_seq = NULL
WHERE order_install IS NOT NULL
  AND student_id IN (SELECT id FROM users WHERE removed_at IS NOT NULL);

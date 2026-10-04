-- A teacher invite is single use (the owner's ruling, 2026-10-04): once redeemed, its row never
-- changes again. Enforced by the database itself, so no code path can redeem it a second time,
-- hand it to another account or take the redeem back. A redeem's guarded UPDATE (`WHERE
-- redeemed_at IS NULL`) never meets this: a row it skips is never updated, so no trigger fires.
CREATE FUNCTION teacher_invites_forbid_rewrite() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'teacher_invites is single use: invite % is already redeemed', OLD.id
    USING ERRCODE = 'raise_exception';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER teacher_invites_single_use
BEFORE UPDATE ON teacher_invites
FOR EACH ROW WHEN (OLD.redeemed_at IS NOT NULL)
EXECUTE FUNCTION teacher_invites_forbid_rewrite();

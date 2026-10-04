-- A redeemed invite is the record of who became a teacher at which school, and when (T1b): no
-- event is written for it. 0013 kept its row from any UPDATE; this keeps it from DELETE too, so
-- no code path can take a redeem off the record (T1a's review). An unredeemed invite can still
-- go, and the redeem's guarded UPDATE still never meets the trigger.
DROP TRIGGER teacher_invites_single_use ON teacher_invites;
--> statement-breakpoint
CREATE TRIGGER teacher_invites_single_use
BEFORE UPDATE OR DELETE ON teacher_invites
FOR EACH ROW WHEN (OLD.redeemed_at IS NOT NULL)
EXECUTE FUNCTION teacher_invites_forbid_rewrite();

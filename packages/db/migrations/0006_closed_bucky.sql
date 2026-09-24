DROP INDEX "events_user_seq_idx";--> statement-breakpoint
CREATE INDEX "events_user_occurred_idx" ON "events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "participations_student_ended_idx" ON "participations" USING btree ("student_id","ended_at");
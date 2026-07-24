ALTER TABLE "parent_links" DROP CONSTRAINT "parent_links_membership_id_memberships_id_fk";
--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participations_student_idx" ON "participations" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open_per_class_uq" ON "sessions" USING btree ("class_id") WHERE "sessions"."ended_at" is null;
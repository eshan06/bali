ALTER TABLE "blocks" DROP CONSTRAINT "blocks_tag_id_unique";--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_join_code_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_tag_active_unique" ON "blocks" USING btree ("tag_id") WHERE "blocks"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_join_code_active_unique" ON "classes" USING btree ("join_code") WHERE "classes"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "enrollments_student_active_idx" ON "enrollments" USING btree ("student_id") WHERE "enrollments"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "events_user_seq_idx" ON "events" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "events_class_occurred_idx" ON "events" USING btree ("class_id","occurred_at");
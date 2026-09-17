CREATE TABLE "armed_taps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"block_id" uuid,
	"event_id" uuid NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "armed_taps_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "armed_taps" ADD CONSTRAINT "armed_taps_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armed_taps" ADD CONSTRAINT "armed_taps_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armed_taps" ADD CONSTRAINT "armed_taps_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "armed_taps_student_teacher_waiting_unique" ON "armed_taps" USING btree ("student_id","teacher_id") WHERE "armed_taps"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "armed_taps_teacher_waiting_idx" ON "armed_taps" USING btree ("teacher_id") WHERE "armed_taps"."consumed_at" IS NULL;
CREATE TABLE "saved_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"teacher_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option" integer,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "saved_questions_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "saved_questions" ADD CONSTRAINT "saved_questions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_questions_teacher_idx" ON "saved_questions" USING btree ("teacher_id");
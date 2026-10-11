CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option" integer,
	"event_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"revealed" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "questions_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"option" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "responses_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "questions_one_open_per_session" ON "questions" USING btree ("session_id") WHERE "questions"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "responses_question_student_unique" ON "responses" USING btree ("question_id","student_id");
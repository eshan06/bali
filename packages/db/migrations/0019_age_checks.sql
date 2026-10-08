CREATE TABLE "age_checks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "age_checks_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "age_checks" ADD CONSTRAINT "age_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
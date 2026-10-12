CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"teacher_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"page_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	CONSTRAINT "decks_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "decks_status" CHECK ("decks"."status" IN ('pending', 'ready', 'rejected')),
	CONSTRAINT "decks_sha256_hex" CHECK ("decks"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_teacher_idx" ON "decks" USING btree ("teacher_id");
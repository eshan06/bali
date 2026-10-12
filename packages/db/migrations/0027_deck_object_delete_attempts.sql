ALTER TABLE "decks" ADD COLUMN "object_delete_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "object_next_attempt_at" timestamp with time zone;
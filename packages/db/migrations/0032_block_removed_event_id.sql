ALTER TABLE "blocks" ADD COLUMN "removed_event_id" uuid;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_removed_event_id_unique" UNIQUE("removed_event_id");
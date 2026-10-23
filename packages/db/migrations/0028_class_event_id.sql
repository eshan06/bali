ALTER TABLE "classes" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_event_id_unique" UNIQUE("event_id");
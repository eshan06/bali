ALTER TABLE "events" ADD COLUMN "order_install" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "order_seq" bigint;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_order_whole" CHECK (("events"."order_install" IS NULL) = ("events"."order_seq" IS NULL));
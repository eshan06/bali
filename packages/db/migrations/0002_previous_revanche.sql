CREATE TYPE "public"."membership_source" AS ENUM('code', 'tag', 'manual');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "source" "membership_source" DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_no_device" boolean DEFAULT false NOT NULL;
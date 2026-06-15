CREATE TABLE "parent_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_teacher_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_created_by_teacher_id_teachers_id_fk" FOREIGN KEY ("created_by_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_links_token_hash_uq" ON "parent_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "parent_links_membership_idx" ON "parent_links" USING btree ("membership_id");
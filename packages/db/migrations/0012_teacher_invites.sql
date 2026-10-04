CREATE TABLE "teacher_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"redeem_event_id" uuid,
	CONSTRAINT "teacher_invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "teacher_invites_redeem_event_id_unique" UNIQUE("redeem_event_id"),
	CONSTRAINT "teacher_invites_code_hash_hex" CHECK ("teacher_invites"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "teacher_invites_redeem_whole" CHECK (("teacher_invites"."redeemed_at" IS NULL) = ("teacher_invites"."redeemed_by" IS NULL) AND ("teacher_invites"."redeemed_at" IS NULL) = ("teacher_invites"."redeem_event_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "agreement_signed_at" date;--> statement-breakpoint
ALTER TABLE "teacher_invites" ADD CONSTRAINT "teacher_invites_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_invites" ADD CONSTRAINT "teacher_invites_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
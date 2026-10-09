CREATE TABLE "cognito_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"username" text NOT NULL,
	"sub" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cognito_deletions_sign_in_unique" ON "cognito_deletions" USING btree ("issuer","sub");
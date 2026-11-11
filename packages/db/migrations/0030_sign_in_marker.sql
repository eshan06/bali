ALTER TABLE "cognito_deletions" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cognito_deletions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cognito_deletions" ADD COLUMN "finished_at" timestamp with time zone;
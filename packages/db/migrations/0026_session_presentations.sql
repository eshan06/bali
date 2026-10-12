CREATE TABLE "session_presentations" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"deck_id" uuid,
	"page" integer,
	"event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_presentations_slide_whole" CHECK (("session_presentations"."deck_id" IS NULL) = ("session_presentations"."page" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "session_presentations" ADD CONSTRAINT "session_presentations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_presentations" ADD CONSTRAINT "session_presentations_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_presentations_deck_idx" ON "session_presentations" USING btree ("deck_id");
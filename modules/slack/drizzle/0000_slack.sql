CREATE TABLE "slack_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"origin" text NOT NULL,
	"as" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_id" uuid,
	"run_id" uuid,
	"error" text,
	"sent_ts" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp (3) with time zone,
	"sent_at" timestamp (3) with time zone,
	CONSTRAINT "slack_outbox_origin_check" CHECK ("slack_outbox"."origin" in ('draft', 'agent', 'report', 'review_ping', 'escalation')),
	CONSTRAINT "slack_outbox_as_check" CHECK ("slack_outbox"."as" in ('bot', 'me')),
	CONSTRAINT "slack_outbox_status_check" CHECK ("slack_outbox"."status" in ('pending', 'approved', 'sent', 'failed', 'discarded')),
	CONSTRAINT "slack_outbox_as_me_draft_check" CHECK ("slack_outbox"."as" = 'bot' or "slack_outbox"."origin" = 'draft'),
	CONSTRAINT "slack_outbox_request_id_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."items"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "slack_people" (
	"slack_user_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"github_login" text,
	"github_from" text DEFAULT 'profile' NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_people_github_from_check" CHECK ("slack_people"."github_from" in ('profile', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "slack_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"team_id" text,
	"bot_user_id" text,
	"owner_slack_id" text,
	"ack_text" text DEFAULT 'Got it, I''ve passed this to Arek.' NOT NULL,
	"threshold" double precision DEFAULT 0.6 NOT NULL,
	"append_minutes" integer DEFAULT 15 NOT NULL,
	"interpreter" text DEFAULT 'typesafe-ai/jev' NOT NULL,
	"coworker_ai" boolean DEFAULT true NOT NULL,
	"runs_synced_at" timestamp (3) with time zone,
	CONSTRAINT "slack_settings_single_row_check" CHECK ("slack_settings"."id" = 1),
	CONSTRAINT "slack_settings_threshold_check" CHECK ("slack_settings"."threshold" between 0 and 1),
	CONSTRAINT "slack_settings_append_minutes_check" CHECK ("slack_settings"."append_minutes" between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_outbox_key_idx" ON "slack_outbox" USING btree ("key");--> statement-breakpoint
CREATE INDEX "slack_outbox_status_idx" ON "slack_outbox" USING btree ("status");
--> statement-breakpoint
INSERT INTO "slack_settings" ("id") VALUES (1);

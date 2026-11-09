CREATE TABLE "slack_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operation" text NOT NULL,
	"token" jsonb NOT NULL,
	"run_task_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "slack_settings" ADD COLUMN "seen_at" timestamp (3) with time zone;
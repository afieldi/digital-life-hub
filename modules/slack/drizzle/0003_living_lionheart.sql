ALTER TABLE "slack_outbox" ALTER COLUMN "approved_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "slack_outbox" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "slack_outbox" ALTER COLUMN "approved_at" SET NOT NULL;

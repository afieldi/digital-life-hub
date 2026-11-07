DELETE FROM slack_outbox WHERE origin = 'draft' OR status IN ('pending','discarded');--> statement-breakpoint
ALTER TABLE "slack_outbox" DROP CONSTRAINT "slack_outbox_as_check";--> statement-breakpoint
ALTER TABLE "slack_outbox" DROP CONSTRAINT "slack_outbox_as_me_draft_check";--> statement-breakpoint
ALTER TABLE "slack_outbox" DROP CONSTRAINT "slack_outbox_origin_check";--> statement-breakpoint
ALTER TABLE "slack_outbox" DROP CONSTRAINT "slack_outbox_status_check";--> statement-breakpoint
ALTER TABLE "slack_outbox" ALTER COLUMN "status" SET DEFAULT 'approved';--> statement-breakpoint
ALTER TABLE "slack_outbox" DROP COLUMN "as";--> statement-breakpoint
ALTER TABLE "slack_outbox" ADD CONSTRAINT "slack_outbox_origin_check" CHECK ("slack_outbox"."origin" in ('agent', 'report', 'review_ping', 'escalation'));--> statement-breakpoint
ALTER TABLE "slack_outbox" ADD CONSTRAINT "slack_outbox_status_check" CHECK ("slack_outbox"."status" in ('approved', 'sent', 'failed'));
ALTER TABLE "agent_runs" ADD COLUMN "audience" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "hub_approvals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "coworker_connection_ids" uuid[] DEFAULT '{}' NOT NULL;
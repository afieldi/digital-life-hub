ALTER TABLE "tasks" ADD COLUMN "assignee" text DEFAULT 'me' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_check" CHECK ("tasks"."assignee" in ('me', 'agent'));
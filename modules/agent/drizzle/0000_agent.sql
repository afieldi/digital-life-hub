-- request_id is SET NULL, not cascade: a deleted request leaves the assignment.
CREATE TABLE "agent_assignments" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"connection_ids" uuid[] DEFAULT '{}' NOT NULL,
	"request_id" uuid,
	CONSTRAINT "agent_assignments_request_id_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."items"("id") ON DELETE set null,
	CONSTRAINT "agent_assignments_task_id_items_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."items"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"scope_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	CONSTRAINT "agent_connections_name_unique" UNIQUE("name"),
	CONSTRAINT "agent_connections_type_check" CHECK ("agent_connections"."type" in ('github', 'aws', 'slack', 'linear', 'gdrive', 'mcp', 'env'))
);
--> statement-breakpoint
CREATE TABLE "agent_run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "agent_run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq"),
	CONSTRAINT "agent_run_events_kind_check" CHECK ("agent_run_events"."kind" in ('text', 'tool', 'tool_result', 'file', 'permission', 'status'))
);
--> statement-breakpoint
CREATE TABLE "agent_run_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"delivered_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"status" text NOT NULL,
	"session_id" text,
	"workspace" text,
	"connection_ids" uuid[] DEFAULT '{}' NOT NULL,
	"pending" jsonb,
	"decision" jsonb,
	"failures" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"failure_code" text,
	"failure_message" text,
	"report" jsonb,
	"turns" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"cost_base_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"running_ms" integer DEFAULT 0 NOT NULL,
	"image" text,
	CONSTRAINT "agent_runs_task_id_items_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."items"("id") ON DELETE cascade,
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('queued', 'running', 'waiting', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "agent_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_connection_ids" uuid[] DEFAULT '{}' NOT NULL,
	"max_parallel" integer DEFAULT 3 NOT NULL,
	"max_running_minutes" integer DEFAULT 240 NOT NULL,
	"max_cost_usd" numeric(10, 2) DEFAULT '10' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	CONSTRAINT "agent_settings_single_row_check" CHECK ("agent_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_active_task_idx" ON "agent_runs" USING btree ("task_id") WHERE "agent_runs"."status" in ('queued', 'running', 'waiting');--> statement-breakpoint
CREATE INDEX "agent_run_messages_run_idx" ON "agent_run_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_queued_idx" ON "agent_runs" USING btree ("created_at") WHERE "agent_runs"."status" = 'queued';
--> statement-breakpoint
INSERT INTO "agent_settings" ("id") VALUES (1);

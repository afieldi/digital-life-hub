CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"action_id" text NOT NULL,
	"kind" text NOT NULL,
	"interpreted_by" text,
	"provider" text NOT NULL,
	"model" text,
	"item_id" uuid,
	"item_version" timestamp (3) with time zone,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric,
	"output" jsonb,
	"undo" jsonb
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_provider" text NOT NULL,
	"openrouter_model" text,
	"interpreter" text DEFAULT 'keywords' NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_single_row" CHECK ("ai_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_created_idx" ON "ai_requests" USING btree ("created_at" DESC NULLS LAST);
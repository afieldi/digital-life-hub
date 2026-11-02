CREATE TABLE "tasks" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"due_date" date,
	"due_at" timestamp (3) with time zone,
	"due_tz" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"notes" text,
	"sort_key" text COLLATE "C" NOT NULL,
	CONSTRAINT "tasks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade,
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('medium', 'high')),
	CONSTRAINT "tasks_due_exclusive_check" CHECK ("tasks"."due_date" is null or "tasks"."due_at" is null),
	CONSTRAINT "tasks_due_tz_check" CHECK ("tasks"."due_tz" is null or "tasks"."due_at" is not null)
);
--> statement-breakpoint
CREATE INDEX "tasks_due_date_open_idx" ON "tasks" USING btree ("due_date") WHERE "tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_due_at_open_idx" ON "tasks" USING btree ("due_at") WHERE "tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_completed_idx" ON "tasks" USING btree ("completed_at" DESC NULLS LAST) WHERE "tasks"."completed_at" is not null;
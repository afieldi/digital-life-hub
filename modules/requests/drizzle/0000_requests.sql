CREATE TABLE "requests" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"body" text,
	"from_name" text,
	"source" text NOT NULL,
	"source_handle" text,
	"source_url" text,
	"external_id" text,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actions" jsonb,
	"resolved_at" timestamp (3) with time zone,
	"outcome" text,
	CONSTRAINT "requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade,
	CONSTRAINT "requests_source_check" CHECK ("requests"."source" in ('manual', 'ai', 'slack', 'agent')),
	CONSTRAINT "requests_outcome_check" CHECK ("requests"."outcome" is null or "requests"."outcome" in ('task', 'handled', 'not_for_me')),
	CONSTRAINT "requests_resolved_pair_check" CHECK (("requests"."outcome" is null) = ("requests"."resolved_at" is null)),
	CONSTRAINT "requests_manual_external_check" CHECK ("requests"."source" <> 'manual' or "requests"."external_id" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "requests_source_external_idx" ON "requests" USING btree ("source","external_id") WHERE "requests"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "requests_open_idx" ON "requests" USING btree ("received_at") WHERE "requests"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "requests_resolved_idx" ON "requests" USING btree ("resolved_at" DESC NULLS LAST) WHERE "requests"."resolved_at" is not null;
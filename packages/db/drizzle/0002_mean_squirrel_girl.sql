CREATE TABLE "item_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"search_text" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(search_text, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_from_to_kind_uq" UNIQUE("from_id","to_id","kind"),
	CONSTRAINT "links_no_self" CHECK ("links"."from_id" <> "links"."to_id")
);
--> statement-breakpoint
ALTER TABLE "item_views" ADD CONSTRAINT "item_views_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_from_id_items_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_to_id_items_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_views_viewed_idx" ON "item_views" USING btree ("viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_views_item_idx" ON "item_views" USING btree ("item_id","viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "items_title_trgm_idx" ON "items" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_type_updated_idx" ON "items" USING btree ("type","updated_at" DESC NULLS LAST) WHERE "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "links_to_idx" ON "links" USING btree ("to_id");
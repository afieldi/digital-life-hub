CREATE TABLE "service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "service_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "service_tokens_kind_check" CHECK ("service_tokens"."kind" in ('worker', 'run')),
	CONSTRAINT "service_tokens_run_check" CHECK (("service_tokens"."kind" = 'run') = ("service_tokens"."run_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "service_tokens_run_idx" ON "service_tokens" USING btree ("run_id");
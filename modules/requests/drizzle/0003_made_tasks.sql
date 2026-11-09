CREATE TABLE "request_made_tasks" (
	"request_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	CONSTRAINT "request_made_tasks_request_id_task_id_pk" PRIMARY KEY("request_id","task_id"),
	CONSTRAINT "request_made_tasks_request_id_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."items"("id") ON DELETE cascade,
	CONSTRAINT "request_made_tasks_task_id_items_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."items"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "request_made_tasks_task_idx" ON "request_made_tasks" USING btree ("task_id");

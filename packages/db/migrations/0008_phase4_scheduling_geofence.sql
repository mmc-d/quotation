ALTER TABLE "project_task" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "project_task" ADD COLUMN "depends_on_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "check_in_distance_m" integer;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "check_in_outside_geofence" boolean;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "outdoor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "schedule_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE TABLE "action_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid,
	"goal_run_id" uuid,
	"capability" text NOT NULL,
	"input" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"policy_decision" text NOT NULL,
	"policy_reason" text NOT NULL,
	"envelope_id" uuid,
	"envelope_version" integer,
	"permit_id" text,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "actions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "actions_status_check" CHECK ("actions"."status" in ('proposed', 'denied', 'awaiting_authorization', 'authorized', 'prepared', 'dispatching', 'uncertain', 'reconciling', 'succeeded', 'failed_retryable', 'failed_permanent', 'verified', 'verification_failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"content_hash" text NOT NULL,
	"policy_reason" text NOT NULL,
	"envelope_id" uuid,
	"envelope_version" integer,
	"permit_id" text,
	"obtained_via" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verification_evidence" jsonb,
	"verified_at" timestamp with time zone,
	CONSTRAINT "receipts_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
CREATE TABLE "goal_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"context" jsonb,
	"decision" jsonb,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"status" text NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "authorization_envelopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_hash" text NOT NULL,
	"status_reason" text,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "authorization_envelopes_goal_version_uq" UNIQUE("goal_id","version"),
	CONSTRAINT "authorization_envelopes_status_check" CHECK ("authorization_envelopes"."status" in ('proposed', 'active', 'superseded', 'revoked', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_identifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "entity_identifiers_uq" UNIQUE("entity_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"scopes" text[] NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_provider_account_uq" UNIQUE("provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routed_at" timestamp with time zone,
	CONSTRAINT "events_source_external_uq" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "expectations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"matcher" jsonb NOT NULL,
	"deadline" timestamp with time zone,
	"status" text NOT NULL,
	"matched_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_participants" (
	"goal_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_participants_goal_id_entity_id_pk" PRIMARY KEY("goal_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"outcome_spec" jsonb NOT NULL,
	"status" text NOT NULL,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" in ('active', 'waiting', 'awaiting_user', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "action_transitions" ADD CONSTRAINT "action_transitions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_goal_run_id_goal_runs_id_fk" FOREIGN KEY ("goal_run_id") REFERENCES "public"."goal_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_envelope_id_authorization_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."authorization_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_envelope_id_authorization_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."authorization_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_runs" ADD CONSTRAINT "goal_runs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_runs" ADD CONSTRAINT "goal_runs_trigger_event_id_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_envelopes" ADD CONSTRAINT "authorization_envelopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_envelopes" ADD CONSTRAINT "authorization_envelopes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_envelopes" ADD CONSTRAINT "authorization_envelopes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expectations" ADD CONSTRAINT "expectations_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expectations" ADD CONSTRAINT "expectations_matched_event_id_events_id_fk" FOREIGN KEY ("matched_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_participants" ADD CONSTRAINT "goal_participants_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_participants" ADD CONSTRAINT "goal_participants_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_transitions_action_idx" ON "action_transitions" USING btree ("action_id","at");--> statement-breakpoint
CREATE INDEX "actions_goal_idx" ON "actions" USING btree ("goal_id","status");--> statement-breakpoint
CREATE INDEX "actions_status_updated_idx" ON "actions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "actions_permit_idx" ON "actions" USING btree ("envelope_id","permit_id");--> statement-breakpoint
CREATE INDEX "goal_runs_goal_idx" ON "goal_runs" USING btree ("goal_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_envelopes_one_active_per_goal" ON "authorization_envelopes" USING btree ("goal_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "authorization_envelopes_goal_idx" ON "authorization_envelopes" USING btree ("goal_id","status");--> statement-breakpoint
CREATE INDEX "entity_identifiers_value_idx" ON "entity_identifiers" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "events_unrouted_idx" ON "events" USING btree ("routed_at");--> statement-breakpoint
CREATE INDEX "expectations_goal_status_idx" ON "expectations" USING btree ("goal_id","status");--> statement-breakpoint
CREATE INDEX "goals_user_status_idx" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id","position");
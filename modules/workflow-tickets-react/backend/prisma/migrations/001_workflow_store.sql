CREATE TABLE IF NOT EXISTS workflow_tickets_entities (
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, entity_id)
);

CREATE INDEX IF NOT EXISTS workflow_tickets_entities_order_idx
  ON workflow_tickets_entities (collection, ordinal);
CREATE INDEX IF NOT EXISTS workflow_tickets_ticket_project_status_updated_idx
  ON workflow_tickets_entities ((payload->>'project_id'), (payload->>'status'), (payload->>'updated_at') DESC)
  WHERE collection = 'tickets';
CREATE INDEX IF NOT EXISTS workflow_tickets_timeline_ticket_created_idx
  ON workflow_tickets_entities ((payload->>'ticket_id'), (payload->>'created_at') DESC)
  WHERE collection = 'timeline';
CREATE INDEX IF NOT EXISTS workflow_tickets_milestone_project_status_idx
  ON workflow_tickets_entities ((payload->>'project_id'), (payload->>'status'))
  WHERE collection = 'milestones';

CREATE TABLE IF NOT EXISTS workflow_tickets_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

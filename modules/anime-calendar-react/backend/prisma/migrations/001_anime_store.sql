CREATE TABLE IF NOT EXISTS anime_calendar_entities (
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, entity_id)
);

CREATE INDEX IF NOT EXISTS anime_calendar_entities_order_idx
  ON anime_calendar_entities (collection, ordinal);
CREATE INDEX IF NOT EXISTS anime_calendar_item_cour_weekday_status_idx
  ON anime_calendar_entities ((payload->>'year'), (payload->>'cour_month'), (payload->>'weekday'), (payload->>'status'))
  WHERE collection = 'items';
CREATE INDEX IF NOT EXISTS anime_calendar_detail_cached_idx
  ON anime_calendar_entities ((payload->>'cached_at') DESC)
  WHERE collection = 'detail_cache';
CREATE INDEX IF NOT EXISTS anime_calendar_notification_sent_idx
  ON anime_calendar_entities ((payload->>'sent_at') DESC)
  WHERE collection = 'notification_history';

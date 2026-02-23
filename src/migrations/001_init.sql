CREATE TABLE IF NOT EXISTS runs (
  run_id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  status_filter TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  result_per_page INT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ NULL,
  pages_fetched INT NOT NULL DEFAULT 0,
  items_fetched INT NOT NULL DEFAULT 0,
  schema_invalid INT NOT NULL DEFAULT 0,
  validated_count INT NOT NULL DEFAULT 0,
  accepted_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  delivery_failed_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  run_id UUID PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  source_page_seq INT NOT NULL DEFAULT 0,
  cursor_in TEXT NULL,
  cursor_out TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_events (
  batch_id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  source_page_seq INT NOT NULL,
  items_count INT NOT NULL,
  cursor_in TEXT NULL,
  cursor_out TEXT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_results (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  gtin TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  schema_valid BOOLEAN NOT NULL,
  business_valid BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_outbox (
  outbox_id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  payload JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_validation_results_run ON validation_results(run_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON delivery_outbox(status, next_retry_at);

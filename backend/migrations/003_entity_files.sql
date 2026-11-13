CREATE TABLE IF NOT EXISTS entity_files (
  ef_id SERIAL PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id INTEGER NOT NULL,
  file_id VARCHAR(40) NOT NULL, caption VARCHAR(200), uploaded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--#
CREATE INDEX IF NOT EXISTS idx_entity_files ON entity_files (entity_type, entity_id);

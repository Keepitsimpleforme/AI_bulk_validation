-- Store raw product snapshot for main-app CSV export (full column set).
ALTER TABLE validation_results
  ADD COLUMN IF NOT EXISTS product_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN validation_results.product_snapshot IS 'Raw/normalized product from GS1 for CSV export to main app';

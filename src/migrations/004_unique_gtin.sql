-- Warning: We must explicitly wipe the 16 Gigabytes of massive historical duplicates first 
-- before the database will allow us to mathematicaly limit the GTIN column to exactly 1 duplicated row.
TRUNCATE TABLE validation_results;

-- Force the GTIN column to physically reject duplicates, creating the master constraint
ALTER TABLE validation_results ADD CONSTRAINT unique_gtin UNIQUE (gtin);

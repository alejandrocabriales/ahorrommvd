-- Enable trigram-based fuzzy search (typo-tolerant matching for merchant/branch/neighborhood names)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX merchant_chains_name_trgm_idx ON merchant_chains USING GIN (name gin_trgm_ops);
CREATE INDEX branches_name_trgm_idx ON branches USING GIN (name gin_trgm_ops);
CREATE INDEX branches_neighborhood_trgm_idx ON branches USING GIN (neighborhood gin_trgm_ops);

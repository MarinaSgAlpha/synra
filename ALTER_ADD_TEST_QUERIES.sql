-- Add test_queries_used column to credentials table
-- Tracks how many free test queries have been used (max 3)

ALTER TABLE credentials
ADD COLUMN test_queries_used INTEGER NOT NULL DEFAULT 0;

-- Add comment
COMMENT ON COLUMN credentials.test_queries_used IS 'Number of free test queries used (max 3 for unpaid users)';

-- Add use_case column to organizations table
ALTER TABLE organizations 
ADD COLUMN use_case TEXT;

COMMENT ON COLUMN organizations.use_case IS 'What the user wants to connect: sql, github, etc.';

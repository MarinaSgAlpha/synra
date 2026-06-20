-- Add Neon as a first-class service in the connections picker.
-- Neon speaks the PostgreSQL wire protocol, so under the hood it routes to
-- the existing PostgreSQL handler — but it gets its own card, its own form
-- title, and Neon-specific placeholders/hints for a native onboarding feel.
--
-- Run this in your Supabase SQL Editor.

INSERT INTO supported_services (slug, name, description, icon_url, config_schema, available_tools, is_active)
VALUES (
  'neon',
  'Neon',
  'Connect your Neon serverless Postgres database. Branches, autoscaling, and scale-to-zero compute all supported.',
  NULL,
  '{"fields": [
    {"key": "host", "label": "Host", "type": "text", "required": true, "encrypted": false, "placeholder": "ep-xxxx-pooler.us-east-2.aws.neon.tech"},
    {"key": "port", "label": "Port", "type": "text", "required": false, "encrypted": false, "placeholder": "5432"},
    {"key": "database", "label": "Database Name", "type": "text", "required": true, "encrypted": false, "placeholder": "neondb"},
    {"key": "user", "label": "Username", "type": "text", "required": true, "encrypted": false, "placeholder": "From your Neon connection string"},
    {"key": "password", "label": "Password", "type": "password", "required": true, "encrypted": true, "placeholder": "From your Neon connection string"},
    {"key": "ssl", "label": "Require SSL", "type": "checkbox", "required": false, "encrypted": false, "placeholder": "Required for Neon (leave checked)"}
  ]}'::jsonb,
  '["list_tables", "describe_table", "query_table", "execute_sql"]'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema,
  available_tools = EXCLUDED.available_tools,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

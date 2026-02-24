-- Add MySQL to supported_services
-- Run this in your Supabase SQL Editor

INSERT INTO supported_services (slug, name, description, icon_url, config_schema, available_tools, is_active)
VALUES (
  'mysql',
  'MySQL',
  'Connect your MySQL database. Works with PlanetScale, AWS RDS, Railway, and any MySQL/MariaDB host.',
  NULL,
  '{"fields": [
    {"key": "host", "label": "Host", "type": "text", "required": true, "encrypted": false, "placeholder": "your-db-host.com"},
    {"key": "port", "label": "Port", "type": "text", "required": false, "encrypted": false, "placeholder": "3306"},
    {"key": "database", "label": "Database Name", "type": "text", "required": true, "encrypted": false, "placeholder": "mydb"},
    {"key": "user", "label": "Username", "type": "text", "required": true, "encrypted": false, "placeholder": "root"},
    {"key": "password", "label": "Password", "type": "password", "required": true, "encrypted": true, "placeholder": "Your database password"},
    {"key": "ssl", "label": "Require SSL", "type": "checkbox", "required": false, "encrypted": false, "placeholder": "Enable for cloud-hosted databases"}
  ]}'::jsonb,
  ARRAY['list_tables', 'describe_table', 'query_table', 'execute_sql'],
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema,
  available_tools = EXCLUDED.available_tools,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

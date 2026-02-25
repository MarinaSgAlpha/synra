-- Add MS SQL Server to supported_services
-- Run this in your Supabase SQL Editor

INSERT INTO supported_services (slug, name, description, icon_url, config_schema, available_tools, is_active)
VALUES (
  'mssql',
  'MS SQL Server',
  'Connect your Microsoft SQL Server or Azure SQL database. Works with Azure SQL, AWS RDS, and on-premises.',
  NULL,
  '{"fields": [
    {"key": "host", "label": "Host / Server", "type": "text", "required": true, "encrypted": false, "placeholder": "yourserver.database.windows.net"},
    {"key": "port", "label": "Port", "type": "text", "required": false, "encrypted": false, "placeholder": "1433"},
    {"key": "database", "label": "Database Name", "type": "text", "required": true, "encrypted": false, "placeholder": "mydb"},
    {"key": "user", "label": "Username", "type": "text", "required": true, "encrypted": false, "placeholder": "sqladmin"},
    {"key": "password", "label": "Password", "type": "password", "required": true, "encrypted": true, "placeholder": "Your database password"},
    {"key": "ssl", "label": "Encrypt connection", "type": "checkbox", "required": false, "encrypted": false, "placeholder": "Enable for Azure and cloud (recommended)"}
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

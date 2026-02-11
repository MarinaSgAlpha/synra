-- Add Mixpanel and Stripe to supported_services
-- Run this in your Supabase SQL Editor

-- Mixpanel
INSERT INTO supported_services (slug, name, description, icon_url, config_schema, available_tools, is_active)
VALUES (
  'mixpanel',
  'Mixpanel',
  'Connect your Mixpanel analytics to query events, funnels, and user profiles via AI',
  NULL,
  '{"fields": [
    {"key": "project_id", "label": "Project ID", "type": "text", "required": true, "encrypted": false},
    {"key": "service_account_username", "label": "Service Account Username", "type": "text", "required": true, "encrypted": false},
    {"key": "service_account_secret", "label": "Service Account Secret", "type": "password", "required": true, "encrypted": true}
  ]}'::jsonb,
  ARRAY['query_events', 'get_top_events', 'get_event_count', 'get_funnel', 'get_user_profiles'],
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema,
  available_tools = EXCLUDED.available_tools,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Stripe
INSERT INTO supported_services (slug, name, description, icon_url, config_schema, available_tools, is_active)
VALUES (
  'stripe',
  'Stripe',
  'Connect your Stripe account to query customers, payments, subscriptions, and revenue via AI',
  NULL,
  '{"fields": [
    {"key": "secret_key", "label": "Secret Key", "type": "password", "required": true, "encrypted": true}
  ]}'::jsonb,
  ARRAY['list_customers', 'get_customer', 'list_charges', 'list_subscriptions', 'list_invoices', 'get_balance', 'list_products', 'get_revenue_summary'],
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema,
  available_tools = EXCLUDED.available_tools,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Verify
SELECT slug, name, is_active, array_length(available_tools, 1) as tool_count
FROM supported_services
ORDER BY name;

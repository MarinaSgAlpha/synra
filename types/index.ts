// Database type definitions for all 12 tables

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  plan: 'free' | 'starter' | 'pro' | 'team';
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  status: 'active' | 'invited' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface SupportedService {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  config_schema: {
    fields: Array<{
      key: string;
      label: string;
      type: 'text' | 'password' | 'url';
      required: boolean;
      encrypted: boolean;
    }>;
  };
  available_tools: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  organization_id: string;
  service_slug: string;
  name: string;
  config: Record<string, any>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface McpEndpoint {
  id: string;
  organization_id: string;
  credential_id: string;
  service_slug: string;
  endpoint_url: string;
  is_active: boolean;
  rate_limit: number;
  allowed_tools: string[] | null;
  created_at: string;
  last_accessed_at: string | null;
}

export interface Subscription {
  id: string;
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
  plan: 'free' | 'starter' | 'pro' | 'team';
  seats: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsageLog {
  id: string;
  organization_id: string;
  credential_id: string | null;
  user_id: string | null;
  service_slug: string | null;
  tool_name: string;
  request_data: Record<string, any> | null;
  response_status: 'success' | 'error';
  error_message: string | null;
  duration_ms: number | null;
  tokens_used: number | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  organization_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  source: string;
  event_type: string;
  event_id: string;
  payload: Record<string, any>;
  processed: boolean;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

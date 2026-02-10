# Synra Database Schema (Supabase)

> **Source of truth.** This is the actual schema in Supabase. Do NOT create migration files — tables already exist.

---

## Tables

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| email | text | NOT NULL, UNIQUE |
| name | text | nullable |
| avatar_url | text | nullable |
| email_verified | boolean | NOT NULL, DEFAULT false |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| last_login_at | timestamptz | nullable |

> **Note:** `users.id` is set to the Supabase Auth user ID on signup.

---

### organizations
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| name | text | NOT NULL |
| slug | text | NOT NULL, UNIQUE |
| logo_url | text | nullable |
| plan | text | NOT NULL, DEFAULT 'free', CHECK (free, starter, pro, team) |
| company_size | text | nullable, CHECK (solo, 2-10, 11-50, 51-200, 201-1000, 1000+) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### organization_members
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| user_id | uuid | NOT NULL, FK → users(id) |
| role | text | NOT NULL, DEFAULT 'member', CHECK (owner, admin, member, viewer) |
| invited_by | uuid | nullable, FK → users(id) |
| invited_at | timestamptz | nullable |
| joined_at | timestamptz | nullable |
| status | text | NOT NULL, DEFAULT 'active', CHECK (active, invited, suspended) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### invitations
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| email | text | NOT NULL |
| role | text | NOT NULL, DEFAULT 'member', CHECK (admin, member, viewer) |
| invited_by | uuid | NOT NULL, FK → users(id) |
| token | text | NOT NULL, UNIQUE |
| expires_at | timestamptz | NOT NULL |
| accepted_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### supported_services
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| slug | text | NOT NULL, UNIQUE |
| name | text | NOT NULL |
| description | text | nullable |
| icon_url | text | nullable |
| config_schema | jsonb | NOT NULL, DEFAULT '{}' |
| available_tools | jsonb | NOT NULL, DEFAULT '[]' |
| is_active | boolean | NOT NULL, DEFAULT true |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### credentials
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| service_slug | text | NOT NULL, FK → supported_services(slug) |
| name | text | NOT NULL |
| config | jsonb | NOT NULL, DEFAULT '{}' |
| is_active | boolean | NOT NULL, DEFAULT true |
| created_by | uuid | nullable, FK → users(id) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| last_used_at | timestamptz | nullable |

---

### mcp_endpoints
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| credential_id | uuid | NOT NULL, FK → credentials(id) |
| service_slug | text | NOT NULL, FK → supported_services(slug) |
| endpoint_url | text | NOT NULL, UNIQUE |
| is_active | boolean | NOT NULL, DEFAULT true |
| rate_limit | integer | DEFAULT 100 |
| allowed_tools | jsonb | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| last_accessed_at | timestamptz | nullable |

---

### subscriptions
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| stripe_customer_id | text | UNIQUE, nullable |
| stripe_subscription_id | text | UNIQUE, nullable |
| status | text | NOT NULL, DEFAULT 'active', CHECK (active, canceled, past_due, trialing, incomplete) |
| plan | text | NOT NULL, DEFAULT 'free', CHECK (free, starter, pro, team) |
| seats | integer | NOT NULL, DEFAULT 1 |
| current_period_start | timestamptz | nullable |
| current_period_end | timestamptz | nullable |
| cancel_at_period_end | boolean | NOT NULL, DEFAULT false |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### usage_logs
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| credential_id | uuid | nullable, FK → credentials(id) |
| user_id | uuid | nullable, FK → users(id) |
| service_slug | text | nullable |
| tool_name | text | NOT NULL |
| request_data | jsonb | nullable |
| response_status | text | NOT NULL, CHECK (success, error) |
| error_message | text | nullable |
| duration_ms | integer | nullable |
| tokens_used | integer | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### api_keys
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| name | text | NOT NULL |
| key_hash | text | NOT NULL, UNIQUE |
| key_prefix | text | NOT NULL |
| last_used_at | timestamptz | nullable |
| expires_at | timestamptz | nullable |
| created_by | uuid | nullable, FK → users(id) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| revoked_at | timestamptz | nullable |

---

### audit_logs
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| organization_id | uuid | NOT NULL, FK → organizations(id) |
| user_id | uuid | nullable, FK → users(id) |
| action | text | NOT NULL |
| resource_type | text | NOT NULL |
| resource_id | uuid | nullable |
| metadata | jsonb | nullable |
| ip_address | text | nullable |
| user_agent | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### webhook_events
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT uuid_generate_v4() |
| source | text | NOT NULL, DEFAULT 'stripe' |
| event_type | text | NOT NULL |
| event_id | text | NOT NULL, UNIQUE |
| payload | jsonb | NOT NULL |
| processed | boolean | NOT NULL, DEFAULT false |
| processed_at | timestamptz | nullable |
| error_message | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

## Key Relationships

```
users.id ←→ Supabase Auth user ID (same UUID)

organizations
  ├── organization_members → users
  ├── credentials → supported_services (via slug)
  │     └── mcp_endpoints
  ├── subscriptions
  ├── usage_logs
  ├── api_keys
  ├── audit_logs
  └── invitations
```

## RLS Notes

- Row Level Security is enabled on all tables
- Server-side admin operations use the service role key (`lib/supabase/admin.ts`)
- Client-side operations go through the anon key with RLS policies

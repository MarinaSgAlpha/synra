# TASK: Add PostgreSQL Support to Synra

## Context

Synra currently supports Supabase as the only service. We are adding **direct PostgreSQL** as a second supported service. This means users can now connect ANY PostgreSQL database (hosted on AWS RDS, Neon, Railway, Render, DigitalOcean, self-hosted, etc.) — not just Supabase.

The existing architecture already supports multiple services via the `supported_services` table and `service_slug` field. We need to:
1. Seed a new `postgresql` entry in `supported_services`
2. Create a new MCP handler for PostgreSQL
3. Update the credentials form to show both options
4. Update the gateway route to pick the right handler

**The MCP tools stay the same:** `list_tables`, `describe_table`, `query_table`, `execute_sql`. The only difference is HOW they connect — Supabase uses its REST API, PostgreSQL uses a direct `pg` connection.

---

## Step 1: Install the `pg` package

```bash
npm install pg
npm install --save-dev @types/pg
```

This is the standard Node.js PostgreSQL client library.

---

## Step 2: Seed PostgreSQL in `supported_services`

Insert a new row into the `supported_services` table in Supabase (SynraDB). You can do this via the Supabase dashboard SQL editor or via the app.

```sql
INSERT INTO supported_services (slug, name, description, config_schema, available_tools, is_active)
VALUES (
  'postgresql',
  'PostgreSQL',
  'Connect to any PostgreSQL database directly. Works with AWS RDS, Neon, Railway, Render, DigitalOcean, self-hosted, and more.',
  '{
    "fields": [
      { "key": "host", "label": "Host", "type": "text", "required": true, "encrypted": false, "placeholder": "db.example.com" },
      { "key": "port", "label": "Port", "type": "text", "required": true, "encrypted": false, "placeholder": "5432" },
      { "key": "database", "label": "Database Name", "type": "text", "required": true, "encrypted": false, "placeholder": "mydb" },
      { "key": "user", "label": "Username", "type": "text", "required": true, "encrypted": false, "placeholder": "postgres" },
      { "key": "password", "label": "Password", "type": "password", "required": true, "encrypted": true },
      { "key": "ssl", "label": "Require SSL", "type": "checkbox", "required": false, "encrypted": false }
    ]
  }',
  '["list_tables", "query_table", "execute_sql", "describe_table"]',
  true
);
```

**IMPORTANT:** The `password` field has `"encrypted": true` — this means the credentials form must encrypt this value with AES-256 before storing, just like it does for Supabase's `api_key`.

---

## Step 3: Create the PostgreSQL MCP Handler

Create a new file: `src/lib/mcp-handlers/postgresql.ts`

This handler must implement the same 4 tools as the Supabase handler, but using the `pg` library instead of the Supabase client.

### Connection Pattern

```typescript
import { Client } from 'pg';

// Create a connection from decrypted credentials
function createPgClient(config: {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}): Client {
  return new Client({
    host: config.host,
    port: parseInt(config.port, 10),
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    // Set a connection timeout so we don't hang forever
    connectionTimeoutMillis: 10000,
    // Set a query timeout for safety
    statement_timeout: 30000,
  });
}
```

### Tool Implementations

**list_tables:**
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

**describe_table (takes `table_name` argument):**
```sql
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default,
  character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = $1
ORDER BY ordinal_position;
```
Use parameterized query with `$1` for `table_name` to prevent SQL injection.

**query_table (takes `table_name`, optional `select`, `filters`, `limit`, `offset`, `order_by`, `order_direction`):**
Build a SELECT query dynamically. Use parameterized queries for filter values. Default limit to 50, max 500. Example:
```sql
SELECT col1, col2 FROM table_name WHERE col1 = $1 ORDER BY col2 ASC LIMIT 50 OFFSET 0
```

**execute_sql (takes `sql` argument):**
Run the SQL through the existing `sql-sanitizer.ts` FIRST to block destructive queries. Then execute via `client.query(sql)`. This is for read-only SELECT queries only.

### Handler Structure

The handler should export a single function that matches the Supabase handler's signature:

```typescript
export async function handlePostgresqlTool(
  toolName: string,
  args: Record<string, any>,
  config: {
    host: string;
    port: string;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const client = createPgClient(config);
  
  try {
    await client.connect();
    
    switch (toolName) {
      case 'list_tables':
        // ... run list_tables query
        break;
      case 'describe_table':
        // ... run describe_table query with args.table_name
        break;
      case 'query_table':
        // ... build and run SELECT query from args
        break;
      case 'execute_sql':
        // ... sanitize then run args.sql
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } finally {
    // ALWAYS close the connection
    await client.end();
  }
}
```

### CRITICAL: Connection Management

For now, create a new connection per request and close it in `finally`. This is simple and safe. We can add connection pooling later with `pg.Pool` if performance becomes an issue.

**Never leave connections open.** Always use try/finally to ensure `client.end()` is called.

---

## Step 4: Update the MCP Gateway Route

File: `src/app/api/mcp/[endpointId]/route.ts`

The gateway currently handles requests and routes them to the Supabase handler. Update it to check the `service_slug` on the endpoint and route to the correct handler:

```typescript
import { handleSupabaseTool } from '@/lib/mcp-handlers/supabase';
import { handlePostgresqlTool } from '@/lib/mcp-handlers/postgresql';

// After looking up the endpoint and decrypting credentials...

let result;
switch (endpoint.service_slug) {
  case 'supabase':
    result = await handleSupabaseTool(toolName, args, decryptedConfig);
    break;
  case 'postgresql':
    result = await handlePostgresqlTool(toolName, args, decryptedConfig);
    break;
  default:
    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported service: ${endpoint.service_slug}` } },
      { status: 400 }
    );
}
```

---

## Step 5: Update the Credentials Form (Dashboard)

File: `src/app/dashboard/credentials/page.tsx` (or wherever the "Add New Credential" form is)

Currently the form is hardcoded for Supabase fields. Update it to:

1. **Show a service selector first** — let the user pick between "Supabase" and "PostgreSQL"
2. **Dynamically render form fields** based on the selected service's `config_schema` from `supported_services`
3. **Encrypt fields marked with `"encrypted": true`** before saving

### Service Selector UI

When the user clicks "Add New Credential", show two cards/options:

```
┌─────────────────┐  ┌─────────────────┐
│   🟢 Supabase   │  │   🐘 PostgreSQL  │
│                  │  │                  │
│  Supabase        │  │  Any PostgreSQL  │
│  projects        │  │  database        │
└─────────────────┘  └─────────────────┘
```

After selecting a service, render the form fields dynamically from `config_schema.fields`:
- `type: "text"` → text input
- `type: "password"` → password input with lock icon and "This value will be encrypted" note
- `type: "checkbox"` → checkbox input

### PostgreSQL Form Fields (from config_schema):
- Host (text, required) — placeholder: "db.example.com"
- Port (text, required) — placeholder: "5432"
- Database Name (text, required) — placeholder: "mydb"
- Username (text, required) — placeholder: "postgres"
- Password (password, required, encrypted) — with encryption note
- Require SSL (checkbox, optional)

---

## Step 6: Update TypeScript Types

File: `src/types/index.ts`

Add or update the config type to support both services:

```typescript
// Supabase credential config
interface SupabaseConfig {
  url: string;
  api_key: string; // encrypted
}

// PostgreSQL credential config
interface PostgresqlConfig {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string; // encrypted
  ssl?: boolean;
}

// Union type for all service configs
type ServiceConfig = SupabaseConfig | PostgresqlConfig;
```

---

## Step 7: Test the PostgreSQL Handler

### Test with curl

After adding PostgreSQL credentials through the dashboard:

```bash
# List tables
curl -s -X POST https://app.mcpserver.design/api/mcp/YOUR_ENDPOINT_ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tables","arguments":{}}}' | python3 -m json.tool

# Describe a table
curl -s -X POST https://app.mcpserver.design/api/mcp/YOUR_ENDPOINT_ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"describe_table","arguments":{"table_name":"users"}}}' | python3 -m json.tool

# Query a table
curl -s -X POST https://app.mcpserver.design/api/mcp/YOUR_ENDPOINT_ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_table","arguments":{"table_name":"users","limit":5}}}' | python3 -m json.tool

# Execute SQL
curl -s -X POST https://app.mcpserver.design/api/mcp/YOUR_ENDPOINT_ID \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_sql","arguments":{"sql":"SELECT COUNT(*) FROM users"}}}' | python3 -m json.tool
```

### Test with Claude Desktop

Add the endpoint URL to Claude Desktop's MCP settings and verify Claude can query the PostgreSQL database conversationally.

---

## What to verify after this task

- [ ] `npm install` succeeds with `pg` and `@types/pg`
- [ ] `supported_services` table has both `supabase` and `postgresql` rows
- [ ] Dashboard shows service selector (Supabase vs PostgreSQL) when adding credentials
- [ ] PostgreSQL form renders correct fields (host, port, database, user, password, ssl)
- [ ] Password field is encrypted before storage
- [ ] MCP gateway routes to correct handler based on `service_slug`
- [ ] `list_tables` returns tables from a PostgreSQL database
- [ ] `describe_table` returns columns with types
- [ ] `query_table` returns rows with filters working
- [ ] `execute_sql` works for SELECT queries
- [ ] `execute_sql` rejects destructive queries (DROP, DELETE, etc.)
- [ ] Connection is always closed after request (no connection leaks)
- [ ] SSL connections work when "Require SSL" is checked
- [ ] Existing Supabase endpoints still work (no regression)

---

## Files Changed / Created

| File | Action |
|------|--------|
| `package.json` | Add `pg` and `@types/pg` |
| `src/lib/mcp-handlers/postgresql.ts` | **NEW** — PostgreSQL MCP handler |
| `src/app/api/mcp/[endpointId]/route.ts` | Update to route by `service_slug` |
| `src/app/dashboard/credentials/page.tsx` | Add service selector + dynamic form |
| `src/types/index.ts` | Add PostgreSQL config types |
| Supabase SQL editor | Seed `postgresql` in `supported_services` |

---

## Security Reminders

- **Password encryption:** The PostgreSQL password MUST be encrypted with AES-256 before storage, same as Supabase API key
- **SQL sanitization:** ALL queries through `execute_sql` must go through `sql-sanitizer.ts` — no exceptions
- **Read-only:** Only SELECT queries allowed. Block INSERT, UPDATE, DELETE, DROP, etc.
- **Connection timeout:** Set `connectionTimeoutMillis: 10000` to prevent hanging on bad hosts
- **Query timeout:** Set `statement_timeout: 30000` to prevent long-running queries
- **SSL:** Support SSL connections for production databases. Use `rejectUnauthorized: false` for flexibility (many managed services use self-signed certs)
- **Never log credentials:** Do not log the password or connection string. Log only metadata (host, database name, tool called)

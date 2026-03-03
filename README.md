Synra — Managed MCP Gateway
Connect Claude and AI agents to your database in 60 seconds.
Synra is a managed MCP (Model Context Protocol) gateway that gives you one secure HTTPS URL to connect AI assistants like Claude to your PostgreSQL, MySQL, MS SQL Server, or Supabase database — no local setup, no config files, no .env headaches.
🔗 mcpserver.design — Sign up free, test your connection, subscribe when ready.

The Problem Synra Solves
Running a local MCP server means:

JSON config files and .env files on every machine
Database credentials sitting in plaintext
No read-only enforcement unless you set it up manually
No audit trail of what queries were run
Every team member manages their own local setup

Synra replaces all of that with one URL.

How It Works
Your Database (PostgreSQL / MySQL / MS SQL / Supabase)
        ↓
  Synra MCP Gateway (mcpserver.design)
  • AES-256 encrypted credentials
  • Read-only enforcement
  • SQL injection protection
  • Audit logging
        ↓
  Claude Desktop / Claude.ai / Any MCP Client

Save credentials — add your database connection details in the Synra dashboard. Encrypted with AES-256 on save.
Get your URL — Synra generates a unique MCP endpoint: https://app.mcpserver.design/api/mcp/{your-token}
Connect Claude — paste the URL into Claude via Settings → Connectors → Add custom connector
Ask questions — query your database in plain English. Claude handles the SQL.


Supported Databases
DatabaseStatusPostgreSQL✅ LiveSupabase✅ LiveMySQL✅ LiveMS SQL Server✅ LiveMore coming🔜
Works with any hosted PostgreSQL — AWS RDS, Neon, Railway, Render, DigitalOcean, PlanetScale, and self-hosted instances.

MCP Tools Exposed
When Claude connects via Synra, it gets access to four read-only tools:
ToolDescriptionlist_tablesReturns all tables and schemas in your databasedescribe_tableReturns columns, types, and constraints for a tablequery_tableRuns a filtered SELECT query on a specific tableexecute_sqlRuns a custom SELECT query
All four are read-only. INSERT, UPDATE, DELETE, DROP, ALTER, and TRUNCATE are blocked at the gateway level — no configuration required.

What You Can Ask Claude
Once connected, ask Claude things like:

"What tables are in my database?"
"How many users signed up this week?"
"Show me all orders with a pending status older than 7 days."
"What's the average revenue per user by signup cohort?"
"Which customers haven't made a purchase in 90 days?"

Claude inspects your schema, writes the SQL, runs it through Synra, and returns the answer. No SQL knowledge needed.

Security

Read-only by default — only SELECT queries allowed, enforced at the gateway
AES-256 encryption — credentials encrypted at rest, decrypted only at request time
SQL sanitization — every query scanned for destructive keywords before execution
Audit logging — full history of every query, tool used, timestamp, and response status
No result storage — query results are never stored, only metadata is logged


Pricing
PlanPriceConnectionsFree$0Test modeStarter$19/month2 databasesLifetime$69 one-time2 databases + lifetime updates
Start free at mcpserver.design — no credit card required to test your connection.

Tech Stack

Framework: Next.js 15 (App Router) with TypeScript
Database: Supabase (multi-tenant, RLS)
Auth: Supabase Auth
Hosting: Railway + Netlify
Encryption: AES-256-GCM
Styling: Tailwind CSS


Who This Is For

Startup founders who want to ask Claude about their business data without writing SQL
Developers connecting AI agents to production databases securely
Small teams who want shared database access through a central MCP gateway
Non-technical users who want conversational analytics without hiring a data analyst


Related

🌐 Marketing site & blog: mcpserver.design
📖 Setup guides: mcpserver.design/blog
📧 Support: hello@mcpserver.design


About
Built by Sam H — founder of Synra and AppSkale.
Synra exists because connecting AI to real business data shouldn't require a DevOps engineer. One URL. Under 60 seconds. Done.

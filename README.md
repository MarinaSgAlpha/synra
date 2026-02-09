# Synra - Managed MCP Gateway SaaS

This is the main Synra application (separate from the marketing site at mcpserver.design).

## What is Synra?

Synra is a managed MCP (Model Context Protocol) gateway that lets developers connect AI assistants like Claude Desktop to their real databases and tools through a single secure URL — no local config files, no .env headaches.

## Tech Stack

- **Framework:** Next.js 15+ (App Router) with TypeScript
- **Database:** Supabase (SynraDB)
- **Auth:** Supabase Auth
- **Hosting:** TBD (Netlify or Vercel)
- **Styling:** Tailwind CSS

## Project Structure

```
synra-app/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Landing page
│   ├── login/             # Auth pages
│   ├── dashboard/         # Protected dashboard
│   └── api/
│       └── mcp/           # MCP Gateway API
├── lib/
│   ├── supabase/          # Supabase clients
│   ├── encryption.ts      # AES-256 encryption
│   └── mcp-handlers/      # MCP tool implementations
├── types/                 # TypeScript definitions
├── components/            # React components
└── middleware.ts          # Auth protection
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Fill in your Supabase credentials and generate an encryption key:
   ```bash
   openssl rand -hex 32
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Open:** http://localhost:3000

## Development Status

**✅ Task 1 Complete:** Project setup with TypeScript, Supabase, and folder structure

**Next:** Task 2 - Auth system with signup/login and automatic org creation

## Environment Variables

See `.env.local.example` for required environment variables.

## Database Schema

The project uses 12 Supabase tables. See `SYNRA_PROJECT_CONTEXT.md` for full schema documentation.

## Security

- All credentials encrypted at rest with AES-256-GCM
- Read-only MCP gateway by default
- SQL sanitization for all queries
- Rate limiting per endpoint
- Complete audit logging

# Database Schema Update - Add Company Size

Run this SQL in your Supabase SQL Editor:

```sql
-- Add company_size column to organizations table
ALTER TABLE organizations 
ADD COLUMN company_size TEXT CHECK (
  company_size IN ('solo', '2-10', '11-50', '51-200', '201-1000', '1000+')
);

-- Make it nullable since existing organizations won't have it
-- You can add a default if you want:
-- ALTER TABLE organizations ALTER COLUMN company_size SET DEFAULT 'solo';
```

After running this, the organizations table will have:
- `id`
- `name`
- `slug`
- `logo_url`
- `plan`
- `company_size` ← NEW
- `created_at`
- `updated_at`

/**
 * SQL Sanitizer — blocks destructive queries
 * Only SELECT statements are allowed through the MCP gateway.
 */

const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
]

export interface SanitizeResult {
  safe: boolean
  reason?: string
}

export function sanitizeSql(sql: string): SanitizeResult {
  if (!sql || typeof sql !== 'string') {
    return { safe: false, reason: 'SQL query is required' }
  }

  const trimmed = sql.trim()

  if (trimmed.length === 0) {
    return { safe: false, reason: 'SQL query is empty' }
  }

  // Must start with SELECT (or WITH for CTEs)
  const upper = trimmed.toUpperCase()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { safe: false, reason: 'Only SELECT queries are allowed' }
  }

  // Block destructive keywords (whole-word match)
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i')
    if (regex.test(sql)) {
      return { safe: false, reason: `Blocked keyword found: ${keyword}` }
    }
  }

  // Block semicolons (prevent multiple statements)
  if (sql.includes(';')) {
    return { safe: false, reason: 'Multiple statements not allowed (semicolons are blocked)' }
  }

  // Block comments that could hide malicious SQL
  if (sql.includes('--') || sql.includes('/*')) {
    return { safe: false, reason: 'SQL comments are not allowed' }
  }

  return { safe: true }
}

/**
 * Sanitize a table name to prevent SQL injection
 * Only allows alphanumeric, underscores, and dots (for schema.table)
 */
export function sanitizeTableName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Table name is required')
  }

  // Only allow safe characters: letters, numbers, underscores, dots
  const sanitized = name.replace(/[^a-zA-Z0-9_.]/g, '')

  if (sanitized !== name) {
    throw new Error(`Invalid table name: ${name}`)
  }

  if (sanitized.length === 0 || sanitized.length > 128) {
    throw new Error('Invalid table name length')
  }

  return sanitized
}

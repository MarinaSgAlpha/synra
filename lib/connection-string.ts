/**
 * Parse a pasted database connection string into the fields of the
 * Add Connection form (host, port, database, user, password, ssl).
 *
 * Supports URIs (postgres://, postgresql://, mysql://, mssql://, sqlserver://,
 * jdbc:...), `psql '...'` style commands, and ADO.NET / SQL Server style
 * "Server=...;Database=...;User Id=...;Password=..." strings.
 *
 * Runs in the browser only. The string is never sent anywhere or stored.
 */

export interface ParsedConnection {
  /** Empty string when the pasted text has no host (existing value is kept). */
  host: string
  port?: string
  database?: string
  user?: string
  password?: string
  ssl?: boolean
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const v = value.trim().toLowerCase()
  if (['true', 'yes', '1', 'require', 'required', 'verify-ca', 'verify-full', 'prefer', 'allow', 'strict'].includes(v)) return true
  if (['false', 'no', '0', 'disable', 'disabled', 'optional'].includes(v)) return false
  return undefined
}

function splitHostPort(hostPort: string): { host: string; port?: string } {
  // IPv6: [::1]:5432
  const v6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (v6) return { host: v6[1], port: v6[2] }
  const match = hostPort.match(/^(.*?)(?::(\d+))?$/)
  return { host: (match?.[1] ?? hostPort).trim(), port: match?.[2] }
}

function hasAnyField(r: ParsedConnection): boolean {
  return Boolean(r.host || r.port || r.database || r.user || r.password)
}

function parseUri(text: string): ParsedConnection | null {
  const match = text.match(/(?:postgres(?:ql)?|mysql|mariadb|mssql|sqlserver):\/\/[^\s'"]+/i)
  if (!match) return null
  const uri = match[0].replace(/^[a-z]+:\/\//i, '')

  // Split off ?query
  const qIndex = uri.indexOf('?')
  let main = qIndex >= 0 ? uri.slice(0, qIndex) : uri
  const query = qIndex >= 0 ? uri.slice(qIndex + 1) : ''

  // SQL Server style: host:1433;database=x;user=y;password=z
  let semicolonProps = ''
  const semi = main.indexOf(';')
  if (semi >= 0) {
    semicolonProps = main.slice(semi + 1)
    main = main.slice(0, semi)
  }

  // authority = everything before the first "/" (database path)
  const slash = main.indexOf('/')
  const authority = slash >= 0 ? main.slice(0, slash) : main
  const path = slash >= 0 ? main.slice(slash + 1) : ''

  // Passwords may contain an unencoded "@", so split on the LAST one.
  const at = authority.lastIndexOf('@')
  const userInfo = at >= 0 ? authority.slice(0, at) : ''
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority

  const result: ParsedConnection = { host: '' }

  if (userInfo) {
    const colon = userInfo.indexOf(':')
    if (colon >= 0) {
      result.user = safeDecode(userInfo.slice(0, colon))
      result.password = safeDecode(userInfo.slice(colon + 1))
    } else {
      result.user = safeDecode(userInfo)
    }
  }

  const { host, port } = splitHostPort(hostPort)
  result.host = safeDecode(host)
  if (port) result.port = port

  if (path) result.database = safeDecode(path.split('/')[0])

  const params = new URLSearchParams(query)
  const props = new URLSearchParams(semicolonProps.replace(/;/g, '&'))
  const get = (...keys: string[]) => {
    for (const source of [params, props]) {
      for (const [k, v] of source.entries()) {
        if (keys.includes(k.toLowerCase())) return v
      }
    }
    return undefined
  }

  if (!result.user) result.user = get('user', 'username', 'uid', 'user id')
  if (!result.password) result.password = get('password', 'pwd')
  if (!result.database) result.database = get('database', 'databasename', 'initial catalog')

  const ssl = parseBool(get('sslmode', 'ssl', 'encrypt', 'sslaccept'))
  if (ssl !== undefined) result.ssl = ssl

  return hasAnyField(result) ? result : null
}

function parseKeyValue(text: string): ParsedConnection | null {
  if (!/(server|data source|host)\s*=/i.test(text)) return null

  const pairs: Record<string, string> = {}
  for (const part of text.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    pairs[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }

  let server = pairs['server'] || pairs['data source'] || pairs['host'] || ''
  server = server.replace(/^tcp:/i, '')

  const result: ParsedConnection = { host: server }
  // SQL Server uses a comma for the port: host,1433
  const comma = server.lastIndexOf(',')
  if (comma >= 0) {
    result.host = server.slice(0, comma)
    result.port = server.slice(comma + 1)
  } else {
    const split = splitHostPort(server)
    result.host = split.host
    if (split.port) result.port = split.port
  }
  if (pairs['port']) result.port = pairs['port']

  result.database = pairs['database'] || pairs['initial catalog'] || pairs['databasename']
  result.user = pairs['user id'] || pairs['uid'] || pairs['user'] || pairs['username']
  result.password = pairs['password'] || pairs['pwd']

  const ssl = parseBool(pairs['encrypt'] ?? pairs['ssl'] ?? pairs['sslmode'])
  if (ssl !== undefined) result.ssl = ssl

  return hasAnyField(result) ? result : null
}

/** Returns the parsed fields, or null if the text isn't a recognisable connection string. */
export function parseConnectionString(raw: string): ParsedConnection | null {
  const text = raw.trim()
  if (!text) return null
  return parseUri(text) ?? parseKeyValue(text)
}

/** True if the text looks like a URI-style connection string (used when pasting into the Host field). */
export function looksLikeConnectionString(text: string): boolean {
  return /^\s*(?:psql\s+)?['"]?(?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mssql|sqlserver):\/\//i.test(text)
}

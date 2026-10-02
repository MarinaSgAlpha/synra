/**
 * Per-connection instructions.
 *
 * Free-text guidance an org attaches to a connection (for example "use only
 * the reporting schema, amounts are in cents"). The MCP gateway hands it to
 * the model on `initialize` and appends it to a tool description, so every
 * session sees it without anyone pasting it into the chat.
 *
 * Stored as a plain (unencrypted) key in `credentials.config`, next to
 * `allowed_tables`. It is guidance for the model, not an access control.
 *
 * Pure functions only — imported by both the dashboard form (client) and the
 * API routes (server).
 */

export const INSTRUCTIONS_KEY = 'instructions'

// Sent on every session, so it costs tokens each time. ~4,000 characters
// fits a long ruleset (roughly 1,000 tokens) without bloating every call.
export const MAX_INSTRUCTIONS_LENGTH = 4000

/** Trim and bound the value; returns null when empty or not a string. */
export function normalizeInstructions(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Read the instructions off a credential's stored config. */
export function getConnectionInstructions(
  config: Record<string, unknown> | null | undefined
): string | undefined {
  const value = normalizeInstructions(config?.[INSTRUCTIONS_KEY])
  if (!value) return undefined
  return value.slice(0, MAX_INSTRUCTIONS_LENGTH)
}

/**
 * Return a copy of the tool list with the instructions appended to one tool
 * description. execute_sql is preferred because it is the tool models read
 * most closely before writing a query. If the endpoint hides it via
 * allowed_tools, the first available tool carries the text instead, so the
 * instructions are never silently dropped.
 *
 * Never mutates the input: the tool definitions are shared module constants.
 */
export function withInstructions<T extends { name: string; description: string }>(
  tools: readonly T[],
  instructions: string | undefined
): T[] {
  if (!instructions || tools.length === 0) return [...tools]

  const target =
    tools.find((t) => t.name === 'execute_sql')?.name ?? tools[0].name

  return tools.map((tool) =>
    tool.name === target
      ? {
          ...tool,
          description: `${tool.description}\n\nInstructions from the owner of this connection:\n${instructions}`,
        }
      : tool
  )
}

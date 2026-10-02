/**
 * Edit-time merge rules for a credential's stored config.
 *
 * The edit form never receives secrets (passwords, API keys), so it submits
 * them blank. Without a merge, saving an edit would drop the secret or force
 * the user to retype it just to change an unrelated setting.
 *
 * Rules:
 *  - A blank secret means "keep the saved one".
 *  - If the connection target changed (host, port, database, user, URL), the
 *    secret must be re-entered. Otherwise anyone who can edit a connection
 *    could point it at their own server and have the stored password sent
 *    there.
 *  - `ssl` does not change where the secret goes, so toggling it is allowed.
 *  - `instructions` and `allowed_tables` are not part of the target.
 *
 * Pure function: no I/O, safe for tests.
 */

const NON_TARGET_KEYS = new Set(['instructions', 'allowed_tables', 'ssl'])

export const TARGET_CHANGED_MESSAGE =
  'You changed the connection details (host, port, database or username). Re-enter the password or key so it can be saved for the new details.'

/**
 * Mutates `processed` to add back any blank secrets from `existing`.
 * Returns an error message if the target changed while a secret was blank.
 */
export function keepBlankSecrets(
  processed: Record<string, string>,
  existing: Record<string, unknown>,
  secretKeys: ReadonlySet<string>
): string | null {
  const kept = [...secretKeys].filter(
    (key) => processed[key] === undefined && typeof existing[key] === 'string'
  )
  if (kept.length === 0) return null

  const keys = new Set(
    [...Object.keys(processed), ...Object.keys(existing)].filter(
      (key) => !secretKeys.has(key) && !NON_TARGET_KEYS.has(key)
    )
  )
  const targetChanged = [...keys].some((key) => {
    const next = (processed[key] ?? '').trim()
    const prev = typeof existing[key] === 'string' ? (existing[key] as string).trim() : ''
    return next !== prev
  })
  if (targetChanged) return TARGET_CHANGED_MESSAGE

  for (const key of kept) processed[key] = existing[key] as string
  return null
}

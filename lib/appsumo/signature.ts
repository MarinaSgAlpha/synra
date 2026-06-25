/**
 * AppSumo webhook signature verification.
 *
 * Every webhook from AppSumo carries two headers:
 *   X-Appsumo-Signature   HMAC SHA256(timestamp + raw_body) using the
 *                         shared API key as the secret. Hex-encoded.
 *   X-Appsumo-Timestamp   Unix timestamp the request was signed at.
 *
 * Verification: re-compute the HMAC on our side from the timestamp and
 * the *raw* request body (do NOT JSON.stringify a parsed object — any
 * key reordering or whitespace difference will break the hash) and
 * compare in constant time.
 *
 * Docs: https://docs.licensing.appsumo.com/webhook/webhook__security.html
 */

import crypto from 'node:crypto'

export const APPSUMO_SIGNATURE_HEADER = 'x-appsumo-signature'
export const APPSUMO_TIMESTAMP_HEADER = 'x-appsumo-timestamp'

/**
 * Maximum allowed age of an AppSumo webhook in seconds. Protects against
 * replay of an old, otherwise-valid signature. AppSumo retries failed
 * deliveries, so we keep this generous (15 minutes).
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 15 * 60

export interface SignatureVerificationResult {
  valid: boolean
  reason?: string
}

/**
 * Verify an AppSumo webhook signature.
 *
 * @param rawBody       The raw request body as received over the wire.
 * @param signature     Value of the X-Appsumo-Signature header.
 * @param timestamp     Value of the X-Appsumo-Timestamp header.
 * @param apiKey        Shared HMAC secret from the AppSumo Partner Portal.
 */
export function verifyAppsumoSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  apiKey: string
): SignatureVerificationResult {
  if (!signature) {
    return { valid: false, reason: 'missing X-Appsumo-Signature header' }
  }
  if (!timestamp) {
    return { valid: false, reason: 'missing X-Appsumo-Timestamp header' }
  }

  // Numeric check first — rejecting garbage early avoids burning CPU on HMAC.
  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) {
    return { valid: false, reason: 'X-Appsumo-Timestamp is not a number' }
  }

  // AppSumo uses seconds in their canonical examples but a handful of
  // events have been observed using milliseconds. Normalize to seconds
  // before doing the skew check.
  const tsSeconds = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return {
      valid: false,
      reason: `timestamp ${tsSeconds} is outside the ${MAX_TIMESTAMP_SKEW_SECONDS}s skew window (now=${nowSeconds})`,
    }
  }

  // Use the timestamp string exactly as AppSumo sent it — re-serializing
  // (e.g. `String(tsSeconds)`) would change ms→s payloads and break the hash.
  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(timestamp + rawBody)
    .digest('hex')

  const provided = signature.trim().toLowerCase()
  const expectedLower = expected.toLowerCase()

  if (provided.length !== expectedLower.length) {
    return { valid: false, reason: 'signature length mismatch' }
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expectedLower, 'utf8')
  )

  return match
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' }
}

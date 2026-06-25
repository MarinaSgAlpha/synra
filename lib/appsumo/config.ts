/**
 * AppSumo Licensing API v2 configuration.
 *
 * All values come from the AppSumo Partner Portal -> API settings.
 * client_id / client_secret are auto-generated once both the webhook
 * and OAuth redirect URLs have been validated. The API key (shared
 * HMAC secret) is shown in the same panel — click the eye icon to reveal.
 *
 * Endpoint reference: https://docs.licensing.appsumo.com/
 */

export const APPSUMO_TOKEN_URL = 'https://appsumo.com/openid/token/'
export const APPSUMO_LICENSE_KEY_URL = 'https://appsumo.com/openid/license_key/'

/**
 * Short-lived signed cookie that carries the AppSumo OAuth `code` from
 * /api/appsumo/oauth/redirect to /appsumo/redeem (which may require the
 * user to log in or sign up before we can complete the exchange).
 *
 * 10 minutes is comfortably under AppSumo's code TTL but long enough to
 * accommodate a new-user signup with email confirmation.
 */
export const APPSUMO_CODE_COOKIE = 'appsumo_oauth_code'
export const APPSUMO_CODE_COOKIE_MAX_AGE_SECONDS = 60 * 10

export interface AppsumoConfig {
  clientId: string
  clientSecret: string
  apiKey: string
  redirectUrl: string
}

/**
 * Read AppSumo credentials from the environment. Throws a clear error
 * if any are missing so the webhook / OAuth routes fail loudly instead
 * of silently mis-signing requests.
 */
export function getAppsumoConfig(): AppsumoConfig {
  const clientId = process.env.APPSUMO_CLIENT_ID
  const clientSecret = process.env.APPSUMO_CLIENT_SECRET
  const apiKey = process.env.APPSUMO_API_KEY
  const redirectUrl = process.env.APPSUMO_REDIRECT_URL

  const missing: string[] = []
  if (!clientId) missing.push('APPSUMO_CLIENT_ID')
  if (!clientSecret) missing.push('APPSUMO_CLIENT_SECRET')
  if (!apiKey) missing.push('APPSUMO_API_KEY')
  if (!redirectUrl) missing.push('APPSUMO_REDIRECT_URL')

  if (missing.length > 0) {
    throw new Error(
      `AppSumo Licensing is not configured. Missing env vars: ${missing.join(', ')}`
    )
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    apiKey: apiKey!,
    redirectUrl: redirectUrl!,
  }
}

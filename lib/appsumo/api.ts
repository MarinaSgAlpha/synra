/**
 * Thin wrappers around AppSumo's OAuth + license-fetch endpoints.
 *
 * Endpoint reference:
 *   POST https://appsumo.com/openid/token/
 *     body (application/x-www-form-urlencoded):
 *       grant_type=authorization_code
 *       client_id, client_secret, redirect_uri, code
 *     response: { access_token, token_type, expires_in, refresh_token, id_token }
 *
 *   GET https://appsumo.com/openid/license_key/?access_token=...
 *     response: { license_key, status, scopes }
 *
 * Per the docs, `status` can be:
 *   "active"      — previously activated; just log the user in
 *   "inactive"    — valid but never activated; this is the normal post-OAuth state
 *   "deactivated" — refunded/revoked; block access
 */

import { APPSUMO_LICENSE_KEY_URL, APPSUMO_TOKEN_URL, type AppsumoConfig } from './config'

export interface AppsumoTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  id_token?: string
  error?: string
}

export interface AppsumoLicenseResponse {
  license_key: string
  status: 'active' | 'inactive' | 'deactivated' | string
  scopes?: string[]
}

export class AppsumoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message)
    this.name = 'AppsumoApiError'
  }
}

/**
 * Exchange a single-use OAuth `code` for an access + refresh token.
 *
 * The redirect_uri sent here MUST match (byte-for-byte) the one saved
 * in the AppSumo Partner Portal — trailing slash, scheme, all of it.
 */
export async function exchangeCodeForToken(
  code: string,
  config: AppsumoConfig
): Promise<AppsumoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUrl,
    code,
  })

  const res = await fetch(APPSUMO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new AppsumoApiError(
      `AppSumo token exchange failed (HTTP ${res.status})`,
      res.status,
      text
    )
  }

  let parsed: AppsumoTokenResponse
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppsumoApiError(
      'AppSumo token endpoint returned non-JSON body',
      res.status,
      text
    )
  }

  // AppSumo sometimes returns 200 with an `error` field set on auth failures.
  if (parsed.error) {
    throw new AppsumoApiError(
      `AppSumo token exchange error: ${parsed.error}`,
      res.status,
      text
    )
  }

  return parsed
}

/**
 * Use the refresh_token to get a fresh access_token without re-prompting
 * the user. Same endpoint, different grant_type.
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: AppsumoConfig
): Promise<AppsumoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  })

  const res = await fetch(APPSUMO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new AppsumoApiError(
      `AppSumo token refresh failed (HTTP ${res.status})`,
      res.status,
      text
    )
  }

  return JSON.parse(text) as AppsumoTokenResponse
}

/**
 * Fetch the user's license_key (and current status) using an access token.
 *
 * The access_token is sent as a query parameter per AppSumo's docs — they
 * don't use a Bearer header on this endpoint.
 */
export async function fetchLicenseForToken(
  accessToken: string
): Promise<AppsumoLicenseResponse> {
  const url = `${APPSUMO_LICENSE_KEY_URL}?access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url, { method: 'GET' })
  const text = await res.text()

  if (!res.ok) {
    throw new AppsumoApiError(
      `AppSumo license fetch failed (HTTP ${res.status})`,
      res.status,
      text
    )
  }

  return JSON.parse(text) as AppsumoLicenseResponse
}

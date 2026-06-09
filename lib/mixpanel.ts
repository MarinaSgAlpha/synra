/**
 * Mixpanel helper — safe no-op if NEXT_PUBLIC_MIXPANEL_TOKEN is missing.
 *
 * Autocapture + session recording are enabled. Use trackEvent / identifyUser
 * for explicit product analytics; autocapture handles passive clicks/views.
 */

import mixpanel from 'mixpanel-browser'

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN
let initialized = false

export function initMixpanel() {
  if (initialized || typeof window === 'undefined' || !TOKEN) return
  mixpanel.init(TOKEN, {
    autocapture: true,
    record_sessions_percent: 100,
    persistence: 'localStorage',
    ignore_dnt: true,
  })
  initialized = true
}

export function trackEvent(name: string, properties?: Record<string, any>) {
  if (typeof window === 'undefined' || !TOKEN) return
  try {
    mixpanel.track(name, properties)
  } catch {
    // Never let analytics break the app
  }
}

export function identifyUser(
  userId: string,
  traits?: Record<string, any>
) {
  if (typeof window === 'undefined' || !TOKEN) return
  try {
    mixpanel.identify(userId)
    if (traits && Object.keys(traits).length > 0) {
      mixpanel.people.set(traits)
    }
  } catch {
    // ignore
  }
}

export function resetUser() {
  if (typeof window === 'undefined' || !TOKEN) return
  try {
    mixpanel.reset()
  } catch {
    // ignore
  }
}

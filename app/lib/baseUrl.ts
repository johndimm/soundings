/**
 * Canonical base URL for the app — derived from SPOTIFY_REDIRECT_URI so that
 * localhost vs 127.0.0.1 inconsistencies don't break cookie auth.
 *
 * e.g. SPOTIFY_REDIRECT_URI = http://127.0.0.1:8000/callback → http://127.0.0.1:8000
 */
export function getBaseUrl(): string {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin
    } catch {}
  }
  return ''
}

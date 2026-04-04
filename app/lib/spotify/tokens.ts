import { cookies } from 'next/headers'
import type { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies'

const ACCESS_TOKEN_COOKIE = 'spotify_access_token'
const REFRESH_TOKEN_COOKIE = 'spotify_refresh_token'
const ACCESS_TOKEN_EXPIRY_COOKIE = 'spotify_access_token_expires_at'
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30 // 30 days
const COOKIE_PATH = '/'
/**
 * `Secure` cookies are not stored on http:// — if NODE_ENV is production (e.g. `next start`)
 * but the request is HTTP, pass `requestIsHttps: false` from the handler.
 * For local `next start` on http://, you can also set `COOKIE_SECURE=false` in `.env.local`.
 */
function cookieSecure(requestIsHttps?: boolean): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false
  if (process.env.COOKIE_SECURE === 'true') return true
  if (requestIsHttps === false) return false
  if (requestIsHttps === true) return true
  return process.env.NODE_ENV === 'production'
}
const REFRESH_THRESHOLD_MS = 60 * 1000 // 1 minute

type CookieStore = Awaited<ReturnType<typeof cookies>>

export interface SpotifyTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

function cookieOptions(maxAge: number, requestIsHttps?: boolean) {
  return {
    httpOnly: true,
    secure: cookieSecure(requestIsHttps),
    maxAge,
    path: COOKIE_PATH,
    sameSite: 'lax' as const,
  }
}

function setAccessTokenCookies(
  cookieStore: CookieStore,
  tokens: SpotifyTokenResponse,
  requestIsHttps?: boolean
) {
  console.info('setAccessTokenCookies: setting cookies', {
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
    expires_in: tokens.expires_in,
    requestIsHttps,
  })
  cookieStore.set(ACCESS_TOKEN_COOKIE, tokens.access_token, cookieOptions(tokens.expires_in, requestIsHttps))
  console.info('setAccessTokenCookies: access token set')

  const expiresAt = Date.now() + tokens.expires_in * 1000
  cookieStore.set(ACCESS_TOKEN_EXPIRY_COOKIE, expiresAt.toString(), cookieOptions(tokens.expires_in, requestIsHttps))
  console.info('setAccessTokenCookies: expiry set')

  if (tokens.refresh_token) {
    cookieStore.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, cookieOptions(REFRESH_TOKEN_MAX_AGE, requestIsHttps))
    console.info('setAccessTokenCookies: refresh token set')
  } else {
    console.warn('setAccessTokenCookies: NO refresh token in response')
  }
}

export function getAccessTokenExpiry(cookieStore: CookieStore): number | null {
  const raw = cookieStore.get(ACCESS_TOKEN_EXPIRY_COOKIE)?.value
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? null : parsed
}

export async function refreshSpotifyAccessToken(
  cookieStore: CookieStore,
  requestIsHttps?: boolean
): Promise<string | null> {
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value
  if (!refreshToken) {
    console.warn('refreshSpotifyAccessToken: no refresh token cookie found')
    return null
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('Spotify client credentials missing')
    return null
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  })

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '')
    console.error('Spotify refresh failed', {
      status: response.status,
      body: responseBody,
      request: { refreshToken: Boolean(refreshToken), clientId: Boolean(clientId), clientSecret: Boolean(clientSecret) },
    })
    return null
  }

  const tokens = (await response.json()) as SpotifyTokenResponse
  setAccessTokenCookies(cookieStore, tokens, requestIsHttps)
  return tokens.access_token
}

export function storeSpotifyTokens(
  cookieStore: CookieStore,
  tokens: SpotifyTokenResponse,
  requestIsHttps?: boolean
) {
  setAccessTokenCookies(cookieStore, tokens, requestIsHttps)
}

export function storeSpotifyTokensInResponse(
  responseCookies: ResponseCookies,
  tokens: SpotifyTokenResponse,
  requestIsHttps?: boolean
) {
  responseCookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, cookieOptions(tokens.expires_in, requestIsHttps))
  const expiresAt = Date.now() + tokens.expires_in * 1000
  responseCookies.set(ACCESS_TOKEN_EXPIRY_COOKIE, expiresAt.toString(), cookieOptions(tokens.expires_in, requestIsHttps))
  if (tokens.refresh_token) {
    responseCookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, cookieOptions(REFRESH_TOKEN_MAX_AGE, requestIsHttps))
  }
}

function serializeCookie(name: string, value: string, maxAge: number, requestIsHttps?: boolean): string {
  const parts = [`${name}=${value}`, `Path=${COOKIE_PATH}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax']
  if (cookieSecure(requestIsHttps)) parts.push('Secure')
  return parts.join('; ')
}

export function buildSpotifyTokenSetCookieHeaders(
  tokens: SpotifyTokenResponse,
  requestIsHttps?: boolean
): string[] {
  const expiresAt = Date.now() + tokens.expires_in * 1000
  const headers = [
    serializeCookie(ACCESS_TOKEN_COOKIE, tokens.access_token, tokens.expires_in, requestIsHttps),
    serializeCookie(ACCESS_TOKEN_EXPIRY_COOKIE, expiresAt.toString(), tokens.expires_in, requestIsHttps),
  ]
  if (tokens.refresh_token) {
    headers.push(serializeCookie(REFRESH_TOKEN_COOKIE, tokens.refresh_token, REFRESH_TOKEN_MAX_AGE, requestIsHttps))
  }
  return headers
}

export function clearSpotifyTokensFromResponse(responseCookies: ResponseCookies, requestIsHttps?: boolean) {
  responseCookies.set(ACCESS_TOKEN_COOKIE, '', cookieOptions(0, requestIsHttps))
  responseCookies.set(ACCESS_TOKEN_EXPIRY_COOKIE, '', cookieOptions(0, requestIsHttps))
  responseCookies.set(REFRESH_TOKEN_COOKIE, '', cookieOptions(0, requestIsHttps))
}

export const ACCESS_TOKEN_COOKIE_NAME = ACCESS_TOKEN_COOKIE
export const REFRESH_TOKEN_COOKIE_NAME = REFRESH_TOKEN_COOKIE
export const ACCESS_TOKEN_EXPIRY_COOKIE_NAME = ACCESS_TOKEN_EXPIRY_COOKIE
export const TOKEN_REFRESH_THRESHOLD_MS = REFRESH_THRESHOLD_MS

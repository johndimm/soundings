const YT_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/

/**
 * Parse an 11-character video id or a full YouTube / youtu.be URL into a video id.
 * Safe for client and server (no Node APIs).
 */
export function extractYoutubeVideoId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (YT_VIDEO_ID_RE.test(s)) return s
  try {
    const u = new URL(s, 'https://www.youtube.com')
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && YT_VIDEO_ID_RE.test(id) ? id : null
    }
    const v = u.searchParams.get('v')
    if (v && YT_VIDEO_ID_RE.test(v)) return v
    const parts = u.pathname.split('/').filter(Boolean)
    for (const key of ['embed', 'shorts', 'live']) {
      const i = parts.indexOf(key)
      if (i >= 0 && parts[i + 1] && YT_VIDEO_ID_RE.test(parts[i + 1])) return parts[i + 1]
    }
  } catch {
    /* invalid URL */
  }
  return null
}

/** Like {@link extractYoutubeVideoId}, but also finds the first YouTube URL inside surrounding text. */
export function extractYoutubeVideoIdLoose(input: string): string | null {
  const direct = extractYoutubeVideoId(input)
  if (direct) return direct
  const s = input.trim()
  if (!s) return null
  const re = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const raw = m[0]
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const id = extractYoutubeVideoId(candidate)
    if (id) return id
  }
  return null
}

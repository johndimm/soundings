/**
 * Share id parsing.
 *
 * Ids produced by `genShareId()` in `app/api/share/route.ts` are 10 lowercase
 * base36 characters (4–10 in the extreme case where `Math.random()` returned
 * a very small number). Tolerate trailing junk when reading the `?share=`
 * query param or a stashed pending-share value: some messaging apps (iMessage,
 * WhatsApp, Mail share sheet, etc.) concatenate the `text` / `title` fields
 * passed to `navigator.share()` onto the URL when they paste it, producing
 * e.g. `?share=abcd012345Listen on Foo`.
 *
 * We match a leading run of at most 10 lowercase base36 chars. Uppercase or
 * whitespace ends the id, so titles/captions are stripped cleanly.
 */

const SHARE_ID_RE = /^[a-z0-9]{1,10}/
const SHARE_ID_MIN_LEN = 4

/** Return the share id extracted from the front of `raw`, or null if none. */
export function parseShareId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(SHARE_ID_RE)
  if (!m) return null
  return m[0].length >= SHARE_ID_MIN_LEN ? m[0] : null
}

# YouTube API Services — Implementation, Access, Integration, and Use

**Product / project:** Soundings (music listening and discovery web application)  
**Document purpose:** Support quota increase request for Google Cloud / YouTube Data API v3  
**Last updated:** April 2026  

---

## 1. Summary

Soundings is a web application that recommends music using an LLM (“DJ”), then resolves each recommendation to a playable track. When the user selects **YouTube** as the playback source, the backend uses the **YouTube Data API v3** only to **search for embeddable videos** matching text queries produced by the LLM. Playback uses the **YouTube IFrame Player API** in the browser (official embed), not the Data API.

We do **not** use the Data API to read or modify user-owned YouTube data, channels, playlists, or subscriptions. Access is **server-side** with an **API key** (no OAuth for YouTube).

---

## 2. API client identity and deployment

| Item | Detail |
|------|--------|
| **Client type** | Custom server-side integration (Node.js / Next.js API routes) |
| **Credential** | YouTube Data API v3 **API key** stored in environment variable `YOUTUBE_API_KEY` on the server |
| **Exposure** | The API key is **not** sent to the browser or bundled in client JavaScript |
| **Public URL** | May be deployed privately or behind authentication; if reviewers cannot access the live app, a **screencast** demonstrating the flows below should be supplied separately (per Google’s form instructions). |

---

## 3. YouTube Data API v3 — which methods and why

### 3.1 Endpoint used

- **`search.list`**  
  - **Base:** `https://www.googleapis.com/youtube/v3/search`  
  - **Implementation:** `app/lib/youtube.ts` (`searchYouTube`)

**Optional zero-quota path:** When the LLM includes a trustworthy **`youtube_url`** or **`youtube_video_id`** on a song (parsed in `app/lib/llm.ts` into `youtubeVideoId`), resolution uses **`youtubeTrackFromVideoId`** in `app/lib/youtube.ts` — **no Data API call** (public thumbnail URL + IFrame playback). **`search.list`** is used only as a **fallback** when the LLM omits a video id (same as title-only resolution).

### 3.2 Request parameters (fixed set)

| Parameter | Value | Purpose |
|-----------|--------|---------|
| `part` | `snippet` | Required metadata for display and mapping to our internal track model |
| `q` | Text search string from LLM suggestion (e.g. song title / artist) | Find a matching video |
| `type` | `video` | Restrict to videos |
| `videoEmbeddable` | `true` | Prefer videos allowed for embedding via IFrame API |
| `maxResults` | `1` | One best match per query to minimize quota use |
| `key` | Server API key | Authenticate the request |

### 3.3 Response fields consumed

From each search result item we use:

- **`id.videoId`** — Unique video identifier; used for playback URL and IFrame player.
- **`snippet.title`** — Display name; optionally parsed as “Artist - Title” when a dash pattern exists.
- **`snippet.channelTitle`** — Shown as artist fallback when title parsing does not apply.
- **`snippet.thumbnails`** — A single thumbnail URL (`high`, `medium`, or `default`) for album-art style display in the UI.

We do **not** store full channel pages, comment threads, or unrelated metadata beyond what is needed for playback and UI.

### 3.4 Quota and efficiency measures

- Each successful `search.list` call consumes quota units as defined by Google (implementation comments reference 100 units per search).
- **Disk cache:** Results are cached in `.youtube-cache.json` (keyed by normalized query) so repeated queries do not repeat API calls across restarts.
- **Session backoff:** On `403` with `quotaExceeded` / `dailyLimitExceeded`, the server stops calling the API until a configured reset window and returns HTTP 429 to the client with `retryAfterMs`.
- **Client display:** Remaining search budget (implementation-defined) may be surfaced in the session UI when source is YouTube.

---

## 4. How the Data API fits in the application flow

1. User session and LLM produce **text suggestions** (`search` strings), not YouTube IDs.
2. **POST `/api/next-song`** receives `source: 'youtube'` and resolves suggestions by calling `searchYouTube` for each suggestion in sequence (`resolveYouTubeSongs` in `app/api/next-song/route.ts`).
3. Successful resolutions return JSON including resolved **tracks** (video id, title, artist, thumbnail) plus optional DJ metadata (reason, coordinates, etc.).
4. The **browser** never calls the Data API; it only receives already-resolved track objects from our API.

This matches Google’s expectation that API access is tied to a clear user-facing feature (music playback from search results).

---

## 5. YouTube IFrame Player API (browser — separate from Data API quota)

**Not** part of YouTube Data API v3 quota, but relevant to “integration and use” of YouTube content:

- **Component:** `app/player/YoutubePlayer.tsx`
- **Loader:** `https://www.youtube.com/iframe_api`
- **Behavior:** Embeds `YT.Player` for the current `videoId`, autoplay and inline playback where supported; `onStateChange` detects **ENDED** to support auto-advance in the player.
- **Player parameters (examples):** `autoplay`, `modestbranding`, `rel=0`, `playsinline`
- **User-visible integration:** When the current track is YouTube-sourced, the main player area shows the embedded player instead of static album art; users can open `https://www.youtube.com/watch?v={videoId}` from the UI.

---

## 6. Data handling, retention, and compliance

| Topic | Practice |
|--------|----------|
| **User authentication** | App uses Spotify OAuth for *Spotify* features; YouTube integration does **not** require users to sign in to Google for Data API use. |
| **Data minimization** | Only fields needed for search resolution and playback UI are retained in cache and application state. |
| **API Terms** | Intended use: search and embed publicly available video content for playback in accordance with YouTube API Services Terms of Service and Developer Policies. |
| **Embeddability** | Search constrained with `videoEmbeddable=true` to align with embedding. |

---

## 7. If the API client is not publicly accessible

Per Google’s instructions: provide a **detailed screencast** that shows, for this application:

1. Selecting or using **YouTube** as the playback source (if applicable in settings).
2. The app receiving LLM/DJ suggestions and **resolving** them to YouTube videos (loading tracks into queue / “Up next”).
3. **Playback** via the embedded YouTube player and **navigation** to the watch URL on youtube.com.
4. Any **rate limit / quota** messaging shown when searches are constrained (if triggered in the demo).

---

## 8. Spotify IDs vs YouTube suggestions (why “promote” paths differ)

DJ suggestions are **text-first**: every row has a required **`search`** string (title / artist for lookup). Optional accelerators are **source-specific**:

| Field | Spotify | YouTube |
|--------|---------|---------|
| **`spotifyId`** (optional) | When present and trusted, the client can batch-resolve via Spotify Web API **track ids** (`promoteDjPendingByIdOnly` in `PlayerClient.tsx`) without a text search. | **Not used.** YouTube playback does not use Spotify track ids. |
| **`youtubeVideoId`** / URL (optional) | N/A | When present, **`resolveYouTubeSongs`** uses **`youtubeTrackFromVideoId`** — **no Data API search**, **0 quota** for that row. |
| **Neither id** | Server falls back to **Spotify search** from `search`. | Server falls back to **`search.list`** via **`searchYouTube`** (costs quota; cached in `.youtube-cache.json`). |

So: **YouTube suggestions do not have a Spotify id**, and they are not expected to. Promotion from the suggestion buffer to the queue still goes through **`resolveOneSuggestion`** → POST **`/api/next-song`** with **`songsToResolve`** and **`source: 'youtube'`**, which either attaches a known **`youtubeVideoId`** or performs one **YouTube search** per row.

---

## 9. Debug endpoint: resolve without Data API quota

For stepping through the client with a **fixed** resolved track (same response shape as the real resolve path, **no** `search.list` call):

- **Route:** `POST /api/youtube-resolve-test`
- **Enable:** `NODE_ENV=development` **or** set **`YOUTUBE_RESOLVE_TEST=1`** on the server.
- **Optional body:** `{ "youtubeVideoId": "11chars", "search": "hint for title/artist split", "reason": "…", "category": "…" }` — defaults to a single well-known example video id.
- **`GET /api/youtube-resolve-test`** (when enabled) returns a short JSON description and a sample `curl`.

**Testing promotion to “Up next” / now playing (no YouTube search quota, no LLM):**

1. **Server:** `YOUTUBE_RESOLVE_TEST=1` (or `NODE_ENV=development`) so **`GET`/`POST /api/youtube-resolve-test`** is enabled, and **`POST /api/next-song`** with **`profileOnly: true`** and **`source: 'youtube'`** **never calls the LLM** — it returns the single fixture suggestion.
2. **Client (optional):** **`NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST=1`** short-circuits **`fetchSuggestions`** locally (no HTTP) when **Source** is **YouTube**. **`fetchProfileOnly`** is skipped in test mode. **`resolveOneSuggestion`** uses **`/api/youtube-resolve-test`** (no **`search.list`**).
3. Switch **Source** to **Spotify** for normal LLM + Spotify again.
4. **Player:** Open **`/player`**, choose **YouTube**, make a DJ choice so suggestions can fill. Leave **room** in Up next to promote.
5. **What happens:** **`consumeDjSuggestionBuffer`** runs **`resolveOneSuggestion`**. With test mode, resolves use the fixture — see **`[dj-queue]`** logs; dedupe may show only one copy in the queue.

If you prefer not to use the env flag, you can point **`resolveOneSuggestion`** at **`/api/youtube-resolve-test`** only while debugging (then revert).

---

## 10. File reference (for reviewers / maintainers)

| Area | Path |
|------|------|
| Data API search + cache + quota handling | `app/lib/youtube.ts` |
| HTTP API route (resolve LLM suggestions to tracks) | `app/api/next-song/route.ts` (`resolveYouTubeSongs`, `source === 'youtube'` branches) |
| Zero-quota debug resolve (fixture response) | `app/api/youtube-resolve-test/route.ts` |
| IFrame player (client) | `app/player/YoutubePlayer.tsx` |
| Player shell / link to youtube.com | `app/player/PlayerClient.tsx` |

---

## 11. Contact

Update this section with your legal / technical contact for the product submitted to Google.

- **Name:**  John Dimm
- **Email:**  john.r.dimm@gmail.com
- **App / deployment URL (if public):**  https://earprint-six.vercel.app/player

---

*This document describes the Soundings codebase as of the date above. If implementation details change, update this file and any materials submitted to Google.*

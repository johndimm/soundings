import AppHeader from '@/app/components/AppHeader'

const FUNCTIONAL_PROMPT = `Soundings is a music discovery app that learns what you like by watching you listen.

The core idea is simple: you sign in, pick a channel, and the app plays you a song. While it plays, you adjust a slider to say how much you liked it — anywhere from zero to a hundred percent. When you're ready for the next song, you press Next. The app records your rating, adds it to your history, and uses an AI to pick the next three songs based on everything you've heard so far. Those three go into a queue, and the cycle continues.

The AI is acting as a DJ. It reads your full rating history and tries to navigate toward music you'll like. Songs you rated highly pull it in that direction. Songs you rated poorly push it away — not from the artist, but from that particular sound. A dislike means "not this sonic territory," not "never play this band again." If you only made it partway through a song without rating it, the app infers mild interest or mild disinterest based on how far you got.

You can shape what the DJ does by setting constraints: preferred genres, a time period, geographic regions, specific artists to lean toward or away from, a popularity slider (underground to mainstream), a discovery slider (familiar to adventurous), and a freeform text field where you can say anything you want to the DJ.

Everything is organized into channels. A channel is a named session with its own history, settings, and AI taste profile. You can run multiple channels simultaneously — one for morning jazz, one for late-night electronica — and switch between them freely. The AI maintains a separate understanding of your taste in each channel.

As you listen, the AI builds a written profile of your taste in plain language. This profile is shown to you and is also fed back to the AI as context for future suggestions, so its understanding of you accumulates across sessions.

The app supports two playback sources: Spotify (if you have a Premium account) and YouTube. The source is decided at login — Spotify OAuth picks Spotify, the YouTube button on the landing page picks YouTube — and logging out returns you to the picker. There is no in-app switcher, because mixing sources on the same channel leaves stale Spotify tracks queued when the app is running under YouTube (or vice versa). Channels keep their ratings, history, and taste profile when you log in under the other source; only the active track and the upcoming queue are cleared. YouTube is quota-limited, so the app tracks how many searches remain today.

There is a history page that shows every song you've heard and how you rated it. You can re-rate songs here, delete them, or select multiple entries and delete them in bulk. Next to the history list is a three-dimensional map that plots every song you've heard in a musical space defined by three axes: how acoustic versus electronic it is, how calm versus intense, and how obscure versus mainstream. You can rotate this map to explore it.

Each channel on the channels settings page also shows a compact version of this music map below the rating history, so you can see the sonic shape of each channel at a glance.

There is a channel settings page where you configure the DJ constraints described above and choose which AI model to use.

Every channel list starts with a special channel named "All." "All" has no configuration — no genres, regions, artists, notes, popularity, or time period — and its discovery slider is pinned to 100. What makes it special is that it learns from your entire listening history across every channel. Whatever you rate on "Jazz" or "Baroque" immediately informs "All" on the next DJ turn; ratings from every channel are merged (deduped by track+artist) before the LLM is queried. To keep payloads small, each non-All channel contributes a stratified sample — its most recent listens plus its highest- and lowest-rated tracks — rather than its full history. All's own history is sent in full. Each channel still keeps its own persisted history; the merge is read-only at query time.

The app works in a demo mode with no login required, using preloaded history data, so anyone can try it before signing up.`

const PROMPT = `Build a web application called Soundings: an AI-powered music discovery app that acts as a personal DJ, learning the user's taste over time through listening and rating.

## Tech Stack

- Next.js App Router (TypeScript, "use client" for interactive pages)
- Tailwind CSS for all styling (dark theme, black/zinc palette)
- Browser localStorage for all persistent state (no backend database)
- LLM integration: Anthropic Claude, OpenAI GPT-4o, DeepSeek, Gemini (user-selectable)
- Music playback: Spotify Web Playback SDK (requires Premium) and YouTube Data API v3
- Authentication: Spotify OAuth 2.0 with email allowlist; YouTube API key only

---

## Core Concept

The app presents one song at a time inside a "channel." The user listens, rates the song by dragging a vertical slider (0–100%), then clicks Next. The LLM receives the full rating history and generates three new song suggestions. These resolve into a queue. When the user clicks Next, the next queued song plays. The LLM is re-queried whenever the queue drops below three songs.

---

## Data Model (localStorage)

### Channel (stored as array in \`earprint-channels\`)
- id: string (generated from timestamp + random)
- name: string (auto-derived from genre history, or user-renamed)
- isAutoNamed: boolean
- createdAt: number (timestamp)
- profile: string (LLM-written taste description, displayed to user)
- cardHistory: HistoryEntry[] (all songs heard and rated)
- sessionHistory: ListenEvent[] (history sent to LLM — lighter version)
- currentCard: CardState | null (track now playing)
- queue: CardState[] (songs ready to play, target depth 3; fills regardless of auto-advance setting)
- genres: string[] (selected genre chips)
- genreText: string (free-text genre override)
- timePeriod: string (era constraint, e.g. "1970s", "baroque era")
- notes: string ("Tell the DJ" freeform text)
- regions: string[] (geographic music tradition filters)
- artists: string[] (quick-pick artist names, toggled on/off)
- artistText: string (free-text artist constraint)
- popularity: number 0–100 (0 = obscure, 100 = mainstream)
- discovery: number 0–100 (0 = familiar, 100 = adventurous)
- source: 'spotify' | 'youtube' (derived from login path, not user-editable in Settings)
- playbackPositionMs: number (saved position when leaving channel)
- playbackTrackUri: string (which track the position belongs to)

### HistoryEntry
Extends ListenEvent with: albumArt (string|null), uri (string|null), category (string), source ('spotify'|'youtube'), coords ({x,y,z}), stars (number|null).

### ListenEvent
- track: string, artist: string
- percentListened: number (0–100, how much of the song was heard)
- reaction: 'move-on' | 'not-now' | 'more-from-artist'
- coords: {x,y,z} (3D music space position)

### SavedSettings (stored in \`earprint-settings\`)
Global per-browser defaults: genres, genreText, timePeriod, notes, regions, artists, artistText, popularity, discovery, source, provider (LLM choice).

---

## Pages

### / — Login page (server component)
- Check for \`spotify_access_token\` cookie. If present, redirect to /player.
- Two login paths: Spotify (requires Premium + whitelisted email) and YouTube (no account, ~100 searches/day from the API key).
- Show error messages if OAuth failed (from query params).
- Include a "Request access" form that emails the admin if email not whitelisted.

### /player — Main player (server → client)
Server component reads cookies and search params, passes accessToken / guideDemo / youtubeOnly flags to a dynamically-imported client wrapper.

The player client component (PlayerClient) manages all state:

**Header:** AppHeader component (shared nav) + channel tabs row.

**Channel tabs row:** Scrollable row of channel name pills. Click active channel name to rename it inline. Click another to switch. "+" links to \`/channels?new=1\`. JSON export/import is on Settings (Channels backup); system reset is on Settings.

**Main body (two-column on desktop):**

Left column — Album art panel (340×580px, full-bleed):
- If Spotify source: album art fills the panel with a slow panning animation when playing. Click to play/pause.
- If YouTube source: YouTube iframe player fills the panel.
- Gradient overlay at bottom with track info: title (links to Spotify/YouTube), artist, year, reason from DJ.
- Play/pause indicator top-right (Spotify only).
- Vertical rating slider on the right side (0–100%, accent-red). Shows "rated" label after submitting.
- Progress bar (seek slider, Spotify only) with elapsed/total time.
- Next button. Loading spinner "Asking the DJ…" while LLM is running.
- Loading spinner "Connecting to Spotify…" while SDK connects.
- Error state with "Sign in with Spotify" and "Try again" buttons.

Right column — SessionPanel:
- "What I know about you" (ProfileView): shows LLM-generated taste profile in color-coded blocks (LIKED/DISLIKED/EXPLORED/NEXT). Edit button opens a textarea.
- Queue section (collapsible): list of upcoming songs with album art, name, artist. Click to play immediately. × to remove. Removing a track records a 0.5-star rating (implicit skip) in both \`cardHistory\` and \`sessionHistory\` so the DJ learns to avoid that sound — unless the track is already in history, in which case the existing rating is preserved.
- Up Next section (collapsible): DJ's pending suggestions (search string + reason), shown while resolving.
- YouTube quota indicator (YouTube mode only): remaining searches count.

**Playback logic:**
- Spotify: uses the Web Playback SDK. Device ID obtained via SDK ready event. Playback controlled via Spotify Web API (play, seek, get state). Polls playback state every second. Crossfade at track end (fade out 800ms, brief pause, then play next). The SDK is not initialized at all in YouTube-only mode (guarded on \`youtubeOnly\`).
- YouTube: embeds YouTube iframe via IFrame API. \`autoplay=1\` in the embed URL starts playback, but the React layer also imperatively calls \`play()\` on the \`YoutubePlayer\` handle when \`currentCard\` changes, because Chrome's cross-origin autoplay-with-sound policy blocks fresh iframes unreliably. The handle tries the YT JS API first, falls back to \`postMessage\` (target origin \`'*'\`, matching the upstream IFrame API's own behavior — specific origins fail against the iframe's \`about:blank\` pre-load state), and latches a \`pendingPlayRef\` for \`onReady\` to consume when the API handshake completes.
- YouTube progress: PlayerClient polls \`getCurrentTime()\` / \`getDuration()\` every 250ms to drive the shared slider. Auto-advances when within 1.5s of \`duration\` and on the \`ended\` state event.
- YouTube wrapper lifecycle: \`new YT.Player(iframe, ...)\` is invoked at most once per component instance (gated by a ref), because binding two wrappers to the same iframe (which Strict Mode's dev-mode double-invoke of effects would otherwise cause) leaves the second wrapper's \`onReady\` silently unfired. Cleanup does NOT call \`YT.Player.destroy()\` — that removes the iframe from the DOM out from under React; the iframe is removed on real unmount instead.
- YouTube autoplay overlay: if playback hasn't visibly started within 3.5s of mount, a tap-to-play overlay appears. A parallel 500ms \`getCurrentTime()\` poll clears the overlay automatically the moment the clock advances, and the overlay click clears itself optimistically (waiting for \`onStateChange\` confirmation left it stuck when the event never arrived).
- YouTube error handling: \`onError 150\` ("video unavailable for embedding") and any other player error auto-advances to the next queue item.
- YouTube start-from-zero: signed-in viewers can otherwise get YouTube's "resume where you left off" offset even on embedded iframes, landing mid-track. Three guards: \`&start=0\` in the embed URL, unconditional \`seekTo(0)\` in \`onReady\` before \`playVideo()\`, and a one-shot safety seek on the first PLAYING state if \`getCurrentTime() > 1.5\`.
- When "Next" is pressed: record percentListened and reaction for the current card, add to history, save channel, then play next song from queue.
- Track progress is tracked as percentListened. "Reaction" defaults to 'move-on'. If the user drags the rating slider, that overrides percentListened.

**LLM queue filling:**
- Target: 3 songs in queue, 3 in a "suggestion buffer" (DJ thinking).
- When buffer runs low, call the LLM (next-song API route).
- LLM returns JSON with "songs" (3 song objects), "profile" (taste description), "suggested_artists".
- Each song object: {search, reason, category, coords, composed?, performer?, spotifyId?, youtubeVideoId?}.
- After getting LLM response, resolve each song via Spotify search (if Spotify source) or YouTube search (if YouTube source).
- Rate-limit handling: if Spotify or YouTube returns 429, back off with exponential backoff and show a yellow banner.
- "settingsDirty" flag: when user changes genres/artists/notes since last LLM call, re-queue LLM with updated constraints on next "Next" press.

**All channel (\`earprint-all\`):**
- Reserved id; always first in the channel list; cannot be deleted or configured (no genre/region/artist/notes/popularity/time-period inputs).
- Discovery is pinned to 100 (\`ALL_CHANNEL_DISCOVERY_DEFAULT\`).
- At DJ query time, a helper \`getDjContextHistories()\` in \`PlayerClient.tsx\` returns the merged \`sessionHistory\` and \`cardHistory\` across every channel, deduped by \`track|artist\`. All's own refs take precedence (freshest), with other channels overlaid after. Used by \`fetchSuggestions\` (alreadyHeard), \`fetchToBuffer\` (sentHistory), and \`fetchProfileOnly\` (sessionHistory + alreadyHeard).
- **Per-channel sampling** (\`sampleForAllChannel\`) caps each non-All channel's contribution to a stratified sample: last \`PER_CHANNEL_SAMPLE_RECENT\` (15) recent entries + \`PER_CHANNEL_SAMPLE_TOP\` (10) highest-rated + \`PER_CHANNEL_SAMPLE_BOTTOM\` (5) lowest-rated. Channels with ≤30 entries return unchanged. All's own history is not sampled.
- For non-All channels, the helper returns the active channel's live refs unchanged — no behavior change, no sampling.
- Each channel still persists its own history; the merge is read-only at query time and does not mutate any channel's stored state.

**Rate limiting and quota tracking:**
- Record all fetch calls with timestamps in memory.
- /status page shows call counts per minute and per hour.
- YouTube searches count against a daily quota (~100/day default).

### /channels — Channel editor (client)
- Left sidebar: list of all channels. Click to select, click active to rename, × to delete, + to create.
- Right: settings form for the active channel, with live writes to localStorage:
  - Discovery slider (0=Familiar … 100=Adventurous)
  - Genre chips (Pop, Rock, Hip-Hop, R&B, Electronic, Jazz, Classical, Country, Folk, Metal, Soul, Blues, Reggae, Latin, Punk) + free-text input
  - Artists free-text input
  - Region chips (US & Canada, UK & Ireland, Western Europe, Scandinavia, Eastern Europe, Latin America, Brazil, Caribbean, Africa, Middle East, India, East Asia, Southeast Asia)
  - Time period chips (40s–Recent, Medieval, Renaissance, Baroque, Classical era, Romantic era, 20th C.) + free-text input
  - Popularity slider (0=Obscure … 100=Mainstream)
  - Tell the DJ textarea (freeform notes)
- LLM selector: dropdown to pick which AI model is used (Claude, GPT-4o, DeepSeek, Gemini). Stored in \`earprint-settings.provider\`.
- Below the rating history list: compact MusicMap showing all heard songs for that channel.
- Changes take effect on the next DJ query.

### /ratings — Ratings history + map (client)
- Channel selector tabs (if multiple channels exist).
- Music Map (3D scatter plot, ~480×380px): all heard songs plotted in 3D music space. Drag to rotate. Green dots = liked (≥50%), red = disliked (<50%), gray = neutral. Tooltip on hover. Animated "dart" when a new song is added.
- History list (reverse chronological): album art thumbnail, track name, artist, rating label (liked/ok/nope), percentListened%, re-rating slider, checkbox for multi-select.
- Select all / Delete selected buttons.
- Entries link out to Spotify or YouTube.

### /prompt — This page (static, server)
Displays the complete specification prompt that was used to build the app (the document you are reading).

### /map — Music map standalone (client)
Full-page 3D scatter plot, auto-refreshes from localStorage every 2s. Shows combined history across all channels. "← Player" back button.

### /status — API call monitor (client)
Shows Spotify and YouTube API call counts per minute and per hour, reading from the in-memory call tracker. Useful for diagnosing rate-limit issues.

---

## LLM Integration

### System prompt (always sent)
Instructs the LLM to act as a DJ navigating a 3D music space:
- X-axis: 0=acoustic/traditional → 100=electronic/synthesized
- Y-axis: 0=calm/sparse → 100=intense/energetic/dense
- Z-axis: 0=underground/obscure → 100=mainstream/chart-topping

Rules:
- Each batch of 3 songs must have 3 different artists (never repeat).
- Slot 1 = nearby (musically adjacent to a liked song); Slot 2 = far (unexplored territory); Slot 3 = wild card surprise within constraints.
- First turn (no history): 3 songs from maximally distant regions.
- Dislike = avoid that sonic territory, not the artist.
- Never invent Spotify IDs or YouTube video IDs — only include if genuinely known.
- Discovery slider adjusts how familiar vs. adventurous the picks are.

### User prompt (built per request)
- User constraints: genres, era, region, notes, artists
- "Already heard" list (avoid repeats)
- Prior taste profile
- Session ratings with positions: \`"Track" by Artist: 82% [move-on] @ (42, 55)\`
- Slot instructions based on discovery setting

### Response format
JSON: { songs: [{search, reason, category, coords, composed?, performer?, spotifyId?, youtubeVideoId?}], profile: string, suggested_artists: string[] }

---

## API Routes

### /api/auth/login
Redirects to Spotify OAuth. Scopes: streaming, user-read-playback-state, user-modify-playback-state, user-read-currently-playing, user-read-private.

### /api/auth/logout
Clears cookies, redirects to /.

### /api/callback
Spotify OAuth callback. Exchanges code for tokens, sets \`spotify_access_token\` cookie (1h) and \`spotify_refresh_token\` cookie (30d). Redirects to /player.

### /api/spotify/token
Refreshes the access token using the refresh token cookie.

### /api/spotify/me
Returns the current user's Spotify profile.

### /api/spotify/ping
Checks Spotify API connectivity, returns status.

### /api/play-track
Plays a Spotify track on the user's active device. Body: {uri, deviceId, positionMs?}.

### /api/next-song
The LLM DJ endpoint. Accepts POST with {sessionHistory, priorProfile, notes, genres, genreText, timePeriod, regions, artists, artistText, popularity, discovery, source, numSongs, alreadyHeard}. Calls the selected LLM provider, returns parsed song suggestions.

### /api/player-config
Returns Spotify client token for Web Playback SDK initialization.

### /api/youtube/ping
Checks YouTube API quota status.

### /api/auth/youtube
Enables YouTube-only mode. Sets the \`earprint_youtube_mode\` cookie (1 year) and redirects to /player?youtube_login=1.

### /api/save-factory
Developer-only snapshot route. POST with the current channels array. Accepts \`?source=spotify|youtube\` and writes to \`data/factory-channels.<source>.json\`; without the param, writes to the shared \`data/factory-channels.json\`. The blank-slate fetch and "reload factory channels" reset both try the source-specific file first, then the shared file, then the built-in import.

### /api/startup-channels
Backs the "Load startup channels" button that appears on the player when the user has no channels (only an empty All row, typically after System Reset). GET with \`?source=spotify|youtube\`:
- \`source=youtube\` → reads \`data/factory-channels-youtube.json\`
- \`source=spotify\` (or omitted) → reads \`data/factory-channels.json\`

Returns \`{ ok, channels, activeChannelId?, savedAt?, source, file }\`. Missing file responds with \`{ ok: false, reason: 'missing_file' }\`. Unlike \`/api/factory-defaults\`, there is no fallback chain — each source maps to one file, named exactly as committed in the repo.

---

## Authentication Flow

**Spotify path:**
1. User clicks "Sign in with Spotify" on login page.
2. /api/auth/login redirects to Spotify OAuth with required scopes.
3. Spotify redirects to /api/callback with code.
4. Callback exchanges code for tokens, sets httpOnly cookies, clears the \`earprint_youtube_mode\` cookie, and redirects to /player?spotify_login=1.
5. Server reads \`spotify_access_token\` cookie on the /player route to verify session.
6. PlayerClient calls /api/player-config to get an SDK token, initializes the Web Playback SDK.

**YouTube path:**
- No user auth. User clicks "YouTube" on the landing page → /api/auth/youtube sets the \`earprint_youtube_mode\` cookie and redirects to /player?youtube_login=1.
- All playback uses the YouTube IFrame API.
- Song searches use the YouTube Data API v3 search.list endpoint (server-side, uses API key from env).
- Quota tracked in memory; shown in /status.

**Fresh-login localStorage scrub:**
- The \`?spotify_login=1\` / \`?youtube_login=1\` query marker tells the client a fresh login just happened.
- \`app/lib/freshLogin.ts\` (module-level flag, called from both the \`PersistentPlayerHost\` render body and the top of \`PlayerClient\`'s hydration effect) rewrites \`earprint-settings.source\` to match the login path and strips every \`currentCard\` / \`queue\` entry whose \`track.source\` doesn't match. History, ratings, genres, notes, sliders, and taste profile are preserved.
- Running from two call sites defeats a Suspense hydration race: \`useSearchParams\` in the host causes the server to render a \`<Suspense>\` fallback that includes \`PlayerClient\`, and that fallback hydrates before the Suspense resolves — so the scrub has to run at the earliest storage-read site, which is \`PlayerClient\` itself.

**Logout:**
- /api/auth/logout clears both Spotify token cookies and the \`earprint_youtube_mode\` cookie, returning the user to the landing picker.

---

## Music Space (3D)

Each song is assigned (x, y, z) coordinates by the LLM:
- x: acoustic ↔ electronic (0–100)
- y: calm ↔ intense (0–100)
- z: obscure ↔ mainstream (0–100)

The Music Map renders these in a 3D canvas using a simple perspective projection. The user can drag to rotate. Dots are color-coded by rating. An animated "dart" flies from the previous song's position to the new one when a song is added.

If a song lacks coords (older entries), the app estimates position from the song's genre category using a lookup table.

---

## Crossfade & Playback Details

- Spotify crossfade: 800ms fade-out at end of track, then immediately play next.
- YouTube: auto-advance on "ended" event. No crossfade (YouTube iframe doesn't support it).
- Seeking near the end of a track (within 1.5s) triggers an immediate advance.
- On mobile, the screen-sleep / background-tab problem is mitigated by watching for playback state to stop and re-issuing the play command.

---

## Channel Switching

When the user switches channels:
- Save playback position (positionMs + trackUri) to the outgoing channel.
- Load the incoming channel's state: history, queue, settings, profile.
- If the incoming channel has a saved position for its currentCard, resume from there.
- All LLM state (pending suggestions, buffer) is cleared.

## Source Switching

The source is decided at login, not in Settings. Switching sources requires logging out and back in via the other path. On fresh login (signaled by \`?spotify_login=1\` / \`?youtube_login=1\`):
- \`earprint-settings.source\` is rewritten to the new source.
- Every channel's \`currentCard\`, \`queue\`, \`playbackPositionMs\`, and \`playbackTrackUri\` are filtered: any entries whose \`track.source\` doesn't match the new source are dropped.
- History, ratings, genres, notes, sliders, and taste profile are preserved on every channel.
- The scrub runs synchronously during hydration (module-level idempotence flag in \`app/lib/freshLogin.ts\`) so \`PlayerClient\` never reads stale cross-source data from localStorage.

---

## Guide Demo Mode

Visiting /player?guide-demo=1 loads a pre-built demo channel (no Spotify auth needed). All mutations to localStorage are skipped. The music map shows demo history data. This mode is used in the public guide (guide.html).

---

## Environment Variables

SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI,
YOUTUBE_API_KEY,
ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GOOGLE_API_KEY,
ALLOWED_EMAILS (comma-separated allowlist for Spotify access),
NEXT_PUBLIC_BASE_URL (for OAuth redirect construction).`

export default function PromptPage() {
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />
      <div className="flex-1 p-4 sm:p-8 max-w-[800px] mx-auto w-full flex flex-col gap-10">

        <section>
          <h2 className="text-base font-semibold mb-1">Functional Prompt</h2>
          <p className="text-xs text-zinc-500 mb-4">
            What the app does, in plain English. No layout or implementation details.
          </p>
          <div className="text-sm text-zinc-700 leading-relaxed bg-zinc-50 border border-zinc-200 rounded-xl p-5 whitespace-pre-wrap">
            {FUNCTIONAL_PROMPT}
          </div>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-1">Technical Prompt</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Full implementation specification for a coding agent.
          </p>
          <pre className="text-xs text-zinc-700 leading-relaxed whitespace-pre-wrap font-mono bg-zinc-50 border border-zinc-200 rounded-xl p-5 overflow-x-auto">
            {PROMPT}
          </pre>
        </section>

      </div>
    </div>
  )
}

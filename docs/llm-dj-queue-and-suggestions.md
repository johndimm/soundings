# LLM → DJ suggestions → queue: behavior and rules

This document describes how **Soundings** uses the LLM’s song list after it returns, how **suggestions** (DJ buffer) relate to **Up Next** (queue), when the LLM is called again, and the main **guard rules**. Implementation lives primarily in `app/player/PlayerClient.tsx` and `app/api/next-song/route.ts`.

---

## 1. Terms (UI vs code)

| UI label | State / ref | Role |
|----------|-------------|------|
| **Up next — queue** | `queue` / `queueRef` | Resolved tracks waiting to play after the current track (target depth **3**). |
| **DJ is thinking… (suggestions)** | `suggestionBuffer` | Raw **LLM rows** (`search` strings, optional `spotifyId`, reasons, coords, …) not yet turned into playable cards or not yet promoted. Target backlog **3** for “full DJ buffer.” |

Constants: `QUEUE_TARGET = 3`, `BUFFER_TARGET = 3`.

---

## 2. What the LLM returns (two server modes)

### 2.1 Client “batch” path — `fetchSuggestions` → `/api/next-song`

The player calls the API with **`profileOnly: true`** (naming is historical). The server runs **`getNextSongQuery`** (the LLM) and returns **`songs`** + optional **`profile`**. It does **not** resolve Spotify or YouTube in this request.

So after this call, the client holds **text suggestions**, not playable tracks yet (except special flows below).

### 2.2 Full server resolve (not used for the main DJ buffer refill)

If the client sent **`profileOnly: false`** and a playback source, the server could run the LLM and then **resolve** tracks in one round trip. The **main** DJ pipeline instead uses **profile-only** LLM batches and resolves **lazily** on the client when promoting rows.

### 2.3 Resolve-only — `songsToResolve`

Separate POSTs with **`songsToResolve`** skip the LLM and only run **Spotify** or **YouTube** lookup. Used when turning one or more suggestion rows into **`CardState`** (playable tracks).

---

## 3. After the LLM returns a list (`fetchToBuffer` success path)

1. **Dedupe** new rows against existing buffer keys (`search` string).
2. **Merge** into `suggestionBuffer` (append, or replace when `replaceBuffer` is true — e.g. constraint replace).
3. **Profile** from the response updates `priorProfile` / UI when present.
4. **Unless** this is the constraint `onCards` path that resolves server-side into cards, the code typically **`consumeDjSuggestionBuffer`** so pending rows move toward **now playing** and **Up Next**.

So: **LLM output always lands in the suggestion buffer first**; playable tracks appear only after **resolve** steps inside **consume**.

---

## 4. `consumeDjSuggestionBuffer` — how suggestions become queue / now playing

Runs when there is **room** (“slots”): no current track and empty queue can take more slots; otherwise it only fills **Up Next** up to **3** behind the current track.

Rough order:

1. **Spotify backoff** — if client rate-limit window is active, **consume** exits early (no API calls).
2. If any pending rows have **Spotify IDs**, **`promoteDjPendingByIdOnly`** may batch-resolve via `/api/next-song` with `songsToResolve` (no LLM).
3. Otherwise **`startPlaybackFromSuggestions`** — resolves one row at a time until there is a **now playing** card (or buffer empty).
4. While there is a current card and **queue length &lt; 3**, **`topUpQueueFromSuggestions`** resolves more rows one-by-one and pushes **CardState** onto **queue**.

Each resolution uses **`resolveOneSuggestion`** → resolve-only API. Failures may drop rows, set backoff, or show errors.

**YouTube** source uses the same suggestion buffer; resolution goes through YouTube search on the server (`source === 'youtube'`).

---

## 5. When do we call the LLM again?

| Trigger | Function | Notes |
|---------|----------|--------|
| **Auto-fill** | `fetchToBuffer()` | When **`suggestionBuffer` is empty**, `historyReady`, not `loadingQueue`, and not in **`djLlmRetryAfterMs`** backoff. Used to refill DJ buffer / queue targets. |
| **Rating** | `fetchProfileOnly()` | After user rates current track — **skipped** if **any** pending suggestions exist or another LLM request is in flight (`fetchingRef`). |
| **Advance without rating** | `fetchToBuffer()` | If user advances without rating and buffer was empty. |
| **Constraint / filters** | `fetchToBuffer(..., force, replaceBuffer)` | Debounced (~600ms) when **genre, notes, time period, popularity, regions, discovery** change vs last commit — **skipped** if current settings **equal** `committedSettings` (no real edit). |
| **Retry** | `fetchToBuffer(..., true)` | User-initiated retry. |
| **Clear history / reset** | `fetchToBuffer(..., true)` | After wiping queue + buffer. |

The **auto-fill** effect does **not** call the LLM while **`suggestionBuffer.length > 0`**; it tries **consume** first.

---

## 6. Rules: when we **do not** call the LLM (`fetchToBuffer`)

These apply in combination as implemented; order matters in code.

- **`fetchingRef` or `resolvingRef`** — another LLM or resolve is in progress (mutex).
- **`djInventoryFull`** — `queue.length >= 3` **and** `suggestionBuffer.length >= 3`. Skips redundant refill (including many **`force: true`** paths such as constraint debounce and retry).
- **Non-force** and **`suggestionBuffer` non-empty** — use pending suggestions before a new LLM batch.
- **Constraint path** (`onCards`) and **Spotify backoff** — skip (cannot resolve to cards).
- **Cooldown** — when queue is “full enough” and buffer wasn’t empty, a **15s**-style cooldown can throttle repeat fetches.
- **`onCards` path** — extra guard against too many Spotify lookups in a short window.

**`fetchProfileOnly`**: skips if **`suggestionBuffer` has any rows** or **`fetchingRef`** is set.

---

## 7. Batch size (`numSongs`)

`computeNumSongs(queueLen, bufferLen, successRate)` estimates how many LLM rows to ask for:

- **Need** = shortfall to `QUEUE_TARGET` + shortfall to `BUFFER_TARGET`.
- Inflates by **Spotify resolve success rate** (tracked in `resolveStatsRef`), clamped **3–10** (`LLM_BATCH_MIN` / `LLM_BATCH_MAX`).
- **Cold start** (empty queue and empty buffer): bumps toward **~9–10** within the cap.

---

## 8. Spotify rate limits and “Heard”

When Spotify returns **429** / client **backoff** is active:

- **`consume`** may skip (cannot call Spotify).
- **`fillFromHeardWhenRateLimited`** can rebuild **queue** / **now playing** from **history** without API calls — **only if** `suggestionBuffer` is **empty** (DJ suggestions always take priority; no Heard replay while pending LLM rows exist).

---

## 9. Constraint / committed settings

- **`fetchToBuffer`** sets **`committedSettings`** when an LLM run **starts** so “what we asked the DJ for” matches sliders.
- **Channel load** (`loadChannelIntoState`) resets **committed** + **dirty** flags from the channel so channel switches don’t look like uncommitted edits.
- The **constraint** `useEffect` depends on a **memoized key** of all DJ fields so the dependency array stays stable; debounced fetch is **skipped** if settings **match** committed (no net change).

---

## 10. File map

| Concern | Location |
|--------|----------|
| Targets, `computeNumSongs`, `djInventoryFull`, `djSettingsMatchCommitted` | `PlayerClient.tsx` (top helpers) |
| `fetchSuggestions`, `fetchProfileOnly`, `fetchToBuffer` | `PlayerClient.tsx` |
| `consumeDjSuggestionBuffer`, `promoteDjPendingByIdOnly`, `startPlaybackFromSuggestions`, `topUpQueueFromSuggestions` | `PlayerClient.tsx` |
| Auto-fill effect, constraint debounce | `PlayerClient.tsx` |
| LLM + resolve routes | `app/api/next-song/route.ts` |

---

*This document reflects the intended design as implemented in the repo; if behavior changes, update this file alongside the code.*

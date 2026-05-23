# LLM result filters — inventory and design stance

Soundings asks an LLM DJ for song suggestions, then turns those text rows into playable tracks. **Most taste and constraint logic belongs in the LLM prompt**, not in application code that second-guesses the model.

This document lists every place the app still filters or transforms LLM output, what was removed, and why.

---

## Design principle

> Moving “smart” processing out of the LLM and into the app is a bad idea.

The app should:

- Pass channel settings, history, and hints to the LLM as **context**
- Trust the LLM to pick songs that fit
- Apply only **mechanical** post-processing needed to play audio (IDs, embeddability, identity dedup)

The app should **not**:

- Classify channel titles or chip labels as “genre” vs “artist”
- Require focus artists to appear in search strings or resolved credits
- Strip or rewrite LLM search text based on genre/style heuristics
- Drop LLM rows because a year field or artist name fails an app-side rule

---

## Removed filters (previously in app code)

These were deleted in favor of LLM-only handling:

| Former behavior | Where it lived | Why removed |
|-----------------|----------------|-------------|
| **Genre vs artist classification** (`isGenreOrStyleTerm`, blocklists, compound-genre detection) | `artistHintsFromNotes.ts`, `suggestArtists.ts` | Deciding whether “Deep House” is a genre or an act is the LLM’s job |
| **Artist focus constraint** (`resolveDjArtistConstraint`, `artistConstraint` API field) | `djArtistFocus.ts`, `PlayerClient.tsx`, `next-song/route.ts` | Artist chips and channel title are **hints** in `buildCombinedNotes`, not hard filters |
| **`FOCUS:` / `ARTIST LIST:` mandatory notes** | `buildCombinedNotes`, `buildUserPrompt` | Artists in the prompt guide choice; they do not constrain resolve |
| **`trackMatchesFocusArtist` on resolve** | `spotify.ts`, `next-song/route.ts`, YouTube resolve | Rejecting Spotify/YouTube hits because credits didn’t match a focus act |
| **Genre prefix stripping** (`stripGenrePrefixesFromSearch`, `enrichSearchWithFocusArtist`, `djGenrePrefixes`) | `spotifyArtistSearch.ts`, `djArtistFocus.ts`, client resolve | Rewriting `"Deep House: …"` before lookup |
| **Same-artist-per-batch LLM rule** | `llm.ts` `SYSTEM_PROMPT` | “Never two songs by the same artist in a batch” — removed from prompt; not enforced in app either |
| **Artist-focus / artist-list prompt exceptions** | `llm.ts` | Hard “all songs must be by X” blocks |
| **Year-range post-filter on `composed`** | `getNextSongQuery` in `llm.ts` | Dropping songs whose `composed` year fell outside parsed era constraints |

---

## What still filters LLM results (and why)

### 1. LLM prompt (primary intelligence)

| Rule | File | Enforced in app? |
|------|------|------------------|
| Slot roles (nearby / far / wild card), discovery mode distances | `llm.ts` `SYSTEM_PROMPT`, `slotInstructions` | No — prompt only |
| User constraints (genres, era, notes, popularity hints) | `buildCombinedNotes` → `notes` in prompt | No — prompt only |
| Artists to lean toward | `buildCombinedNotes` | No — soft hint in prompt |
| Do not repeat already heard/queued | `alreadyHeard` in `buildUserPrompt` | Partially — see dedup below |
| Proper noun preservation | `SYSTEM_PROMPT` | No |
| Trustworthy `spotify_id` / YouTube id when known | `SYSTEM_PROMPT` | Partially — junk IDs rejected mechanically |

### 2. Parse-time (structural only)

| Filter | File | Purpose |
|--------|------|---------|
| Drop rows missing `search` or `reason` | `parseLLMResponse` | Invalid JSON shape |
| Cap at 10 songs, dedupe suggested artists | `parseLLMResponse`, `parseSuggestedArtistsRaw` | Safety bounds |
| Strip slot labels from `reason` text | `parseLLMResponse` | UI cleanup |
| Clamp coords to 0–100 | `parseCoords` | Map display |
| Reject placeholder Spotify IDs | `normalizeSpotifyTrackId` | Prevent bogus API calls |

### 3. Buffer / queue dedup (identity, not taste)

| Filter | File | Purpose |
|--------|------|---------|
| Dedupe new LLM rows by `search` string in buffer | `fetchToBuffer` | Avoid duplicate pending rows |
| Skip track if same uri/id or `name\|artist` already played/queued | `buildPlayedAndQueuedKeys`, `trackIsDuplicate`, promote paths | Don’t replay the same recording |
| Drop resolve failures (empty `songs[]`) | `resolveOneSuggestion`, consume loop | Lookup miss — row removed, not “wrong taste” |

**Note:** Dedup is per **track identity**, not per artist. Multiple different songs by the same artist in the queue is allowed.

### 4. Resolve-time (playback mechanics)

| Filter | File | Purpose |
|--------|------|---------|
| Spotify search: first hit (with dash-split query variants) | `spotify.ts`, `spotifySearchQueriesForSong` | Map text → Spotify track |
| YouTube: embeddable videos only; skip Topic/VEVO channel heuristics | `youtube.ts` | Player must be able to play |
| YouTube alternate queries with `preferredArtists` | `buildYouTubeSearchAlternates` | Extra lookup attempts when title search fails — **not** a credit filter |
| Rate limits / quota / auth | `next-song/route.ts`, client backoff | Infrastructure |

### 5. Operational guards (not taste)

| Guard | File | Purpose |
|-------|------|---------|
| `QUEUE_TARGET` / `BUFFER_TARGET` depth | `PlayerClient.tsx` | UI pipeline sizing |
| `djInventoryFull`, fetch mutex, cooldowns | `PlayerClient.tsx` | Avoid LLM/resolve storms |
| Empty-channel gate until user sets DJ prefs | `shouldDeferLlmUntilDjChoice` | Onboarding |
| Channel-switch discard mid-resolve | `PlayerClient.tsx` | Stale async results |

---

## Data flow (after cleanup)

```
Channel settings + history
    → buildCombinedNotes (hints only)
    → LLM (SYSTEM_PROMPT + buildUserPrompt)
    → parseLLMResponse (structural parse)
    → suggestionBuffer (dedupe by search string)
    → resolveOneSuggestion (search string as-is → Spotify/YouTube API)
    → queue (dedupe by track identity)
```

No step rewrites search text for genre/focus, and no step rejects a resolved track because the credited artist didn’t match a chip.

---

## Related docs

- [LLM → DJ buffer → queue behavior](./llm-dj-queue-and-suggestions.md) — pipeline and auto-fill
- [YouTube Data API design](./youtube-data-api-services-design.md) — quota and resolve test mode

---

## Maintenance

When adding new behavior, ask:

1. Is this **taste** or **constraint** logic? → Belongs in the LLM prompt.
2. Is this **identity** or **playback** logic? → OK in app code, document here.
3. Are we **rewriting** LLM output? → Strong bias against; prefer fixing the prompt.

If this file and the code diverge, update both together.

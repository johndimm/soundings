import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import { extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'
import { getCachedYouTubeVideoId } from '@/app/lib/youtubeCache'
import {
  deprioritizedSupersFromHistory,
  parseCategoryPathsFromRaw,
  pathsToCategoryLabel,
  type CategoryPath,
} from '@/app/lib/categoryTree'

export type { CategoryPath }

export interface ListenEvent {
  track: string
  artist: string
  /** 0–5 in 0.5 increments. Null only for legacy imports or interrupted writes (player now always records a score). */
  stars: number | null
  coords?: { x: number; y: number; z?: number }
  categoryPaths?: CategoryPath[]
}

export interface SongSuggestion {
  search: string
  reason: string
  category?: string
  categoryPaths?: CategoryPath[]
  spotifyId?: string
  /** When set, YouTube resolve skips search.list (saves Data API quota). Parsed from LLM youtube_url / youtube_video_id. */
  youtubeVideoId?: string
  coords?: { x: number; y: number; z?: number }
  composed?: number
  /** Performer/ensemble (classical): separate from the composer in `search` */
  performer?: string
}

export type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'

export const DEFAULT_LLM_PROVIDER: LLMProvider =
  (process.env.DEFAULT_LLM_PROVIDER as LLMProvider) || 'deepseek'

/** API model name used for each provider (keep in sync with ask* fetch bodies). */
export const LLM_MODEL_API_ID: Record<LLMProvider, string> = {
  anthropic: 'claude-opus-4-6',
  openai: 'gpt-4.1',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
}

export function getLLMModelApiId(provider: LLMProvider): string {
  return LLM_MODEL_API_ID[provider]
}

// ── Music Space ──────────────────────────────────────────────────────────────
// Songs live in a high-dimensional space (era, instruments, energy, mood,
// complexity, cultural origin, etc.). We project to 2D for the map.
//
// X-axis: 0 = purely acoustic / traditional / live instruments
//         100 = fully electronic / synthesized / heavily produced
// Y-axis: 0 = calm / sparse / minimal / introspective
//         100 = intense / energetic / dense / driving
//
// These two axes capture the most variance across broad musical styles
// while remaining consistent enough for multiple LLM providers to use.

const SYSTEM_PROMPT = `You are a DJ navigating a listener's taste across a high-dimensional music space.

Each user message includes SONG UNIQUENESS RULES and a compact HEARD SESSION (heardSkip count + recent window) — obey them every turn.

THE 3D MAP (for display — project your full musical knowledge onto these axes):
  X-axis: 0 = purely acoustic/live/traditional instruments → 100 = fully electronic/synthesized
  Y-axis: 0 = calm/sparse/minimal/introspective → 100 = intense/energetic/dense/driving
  Z-axis: 0 = underground/cult/obscure → 100 = mainstream/widely known/chart-topping

Reference anchors (be consistent — the same song should always land near the same position):
  (8, 22, 30)  sparse solo acoustic, calm, cult/obscure
  (12, 35, 55) acoustic chamber ensemble, moderate energy, prestige niche audience
  (18, 50, 40) small-group improvisation, mid energy, respected specialist following
  (25, 70, 35) passionate live performance, high energy, underground reverence
  (40, 55, 88) melodic vocal songcraft, mid-high energy, mass mainstream
  (55, 65, 80) rhythm-forward groove, energetic, very widely known
  (62, 80, 75) amplified band, high intensity, mainstream territory
  (68, 85, 70) heavy distorted guitars, very intense, genre-mainstream
  (75, 45, 72) synth-led production, moderate intensity, influential mid-mainstream
  (88, 28, 20) ambient electronic texture, calm, cult influence
  (93, 80, 45) experimental electronic, intense, niche-within-niche fame

When assigning coords: x/y capture sonic character; z captures how widely known/mainstream the specific recording is (not the artist in general — an obscure deep cut by a famous artist can have low z).

NAVIGATION RULES (ratings are ★0.5–★5 in half-star steps; skipped = no signal):
- ★3.5–★5: liked. Region is promising — Slot 1 should explore its musical neighborhood.
- ★1–★2.5: disliked. Avoid that sonic territory and those attributes — NOT the artist. The same artist may have songs in very different styles; those remain fair game.
- ★3: neutral. Mildly interesting but not a strong pull in either direction.
- (skipped): no taste signal — treat as unheard.

THE 3-SLOT RULE — every batch of 3 must serve distinct purposes:
- Slot 1 — NEARBY: If there are likes (★3.5+), pick something musically adjacent to a liked song (similar instruments, era, energy, or mood). If no likes yet, pick from an UNTRIED super-category — never deepen the most-visited or low-rated area.
- Slot 2 — FAR: Pick from a region of the space that has NOT been visited yet. Maximize musical distance from everything heard. This is mandatory.
- Slot 3 — WILD CARD: Genuine surprise *within the active constraints*. Be unexpected in style, mood, or obscurity — but all constraints (genre, era, region, etc.) still apply. "Wild card" means surprising to the listener, not a licence to ignore what they asked for.

ARTIST DIVERSITY (canvassing the musical landscape):
- Every batch: all songs must be by DIFFERENT artists.
- Do not suggest an artist already heard 2+ times this session unless that artist has a ★4+ track.
- Repeating the same act across batches (e.g. four Kraftwerk songs in a row) is a rut — open a new dimension, super-category, or region instead.

FIRST TURN (no history): Pick 3 songs from maximally distant parts of the coordinate space — spread x, y, and z widely across the batch. You choose which musical areas to explore; the app does not prescribe genres or traditions.

DISLIKE ESCALATION:
- 1 dislike in an area: try one more thing at its edge, then move on.
- 2 dislikes with similar attributes: treat that musical territory as exhausted for this session.
- NEVER suggest a song with the same primary instruments + energy level as a recently disliked song.
- A disliked song does NOT blacklist its artist — only its specific sonic territory.
- If a disliked track is part of a multi-part series (title contains "Part N", "Vol. N", "Chapter N", "Episode N", or a similar numbered suffix), do NOT suggest any other part of that same series — treat the entire series as off-limits for this session.
- **PATTERN DEPRIORITIZATION**: If you notice a consistent pattern of dislikes (multiple low ratings from same genre, region, or era), deprioritize that pattern in favor of orthogonal directions. It's okay to suggest one track from a disliked pattern occasionally if it genuinely fits exploration — just don't cluster them.

If the user provides explicit constraints (genres, eras, styles), follow them strictly — all 3 slots must satisfy the constraints. This overrides the slot rules: even Slot 3 (wild card) must stay within the stated genre and era.

PROPER NOUNS (artist / band names) — strictly enforced:
- Names in USER CONSTRAINTS and quoted strings are musical artists or bands, not topics to translate or reinterpret.
- Copy them character-for-character in "search", "profile", "reason", and "suggested_artists". Do not translate, anglicize, or substitute synonyms.

DATE INTEGRITY — strictly enforced:
- Never invent or round a date to make a track fit a requested era. Only suggest a track if you are genuinely confident it was recorded or first released within the specified time period.
- If you cannot find 3 real tracks that authentically fit all constraints, return fewer songs rather than fabricating dates or misattributing eras.

Also include "suggested_artists": an array of 8–12 DISTINCT real recording-artist or band names that fit the user's constraints and the taste profile — these power UI quick-pick buttons (exploration anchors). Use canonical names only. They need not appear in the 3 song rows; vary styles. If you cannot name enough confidently, include fewer (minimum 4 when possible) or an empty array.

Respond with ONLY a JSON object:
{"songs":[{"search":"track name artist name","reason":"one sentence: why this song fits the taste and space position (do NOT include Slot labels like 'Slot 1:')","category":"super label > leaf label","category_paths":[{"dimension":"region","super":"anglo_american","leaf":"classic rock"}],"composed":1791,"coords":{"x":42,"y":28,"z":35}},{"search":"...","reason":"...","category":"...","category_paths":[{"dimension":"region","super":"...","leaf":"..."}],"coords":{"x":85,"y":72,"z":80}},{"search":"...","reason":"...","category":"...","category_paths":[{"dimension":"genre","super":"...","leaf":"..."}],"coords":{"x":18,"y":55,"z":20}}],"profile":"2-3 natural sentences addressed directly to the listener (use 'you'/'your') describing their emerging taste — grounded in ratings and coordinates you have actually observed. Keep it under 60 words. If nothing rated ★3.5+, say they are still exploring — do NOT claim they love any genre or artist.","suggested_artists":["Artist One","Artist Two","Artist Three","Artist Four","Artist Five","Artist Six","Artist Seven","Artist Eight"]}

When a SESSION CATEGORY TREE is provided in the user message, tag every song with category_paths from that tree (required). The "category" field echoes super > leaf for display.
You may add optional "spotify_id" on any song object when (and only when) you have a trustworthy reference — see rules below.

YOUTUBE (youtube_url or youtube_video_id) — CRITICAL for quota efficiency:
- The server validates every youtube_url / youtube_video_id before playback: oEmbed embeddability, videos.list status, and title relevance vs "search".
- IMPORTANT: Wrong, non-embeddable, or mismatched ids are gracefully rejected and we fall back to search. No penalty — just costs an extra search.
- When you have high confidence in the exact video for this recording (same work, same performer, exact recording), include either:
  - "youtube_url": full https://www.youtube.com/watch?v=… or https://youtu.be/… or music.youtube.com/watch?v=…
  - OR "youtube_video_id": the 11-character id only.
- Confidence threshold: if you're >70% sure this is the right video, include it. Wrong guesses just trigger a fallback search — no cost beyond that single search.
- The "search" field remains required and is the source of truth for validation and fallback lookup.
- QUOTA CONSTRAINT: We have ~700 YouTube searches per day. Every youtube_video_id you provide saves one expensive search and lets us serve more songs.

SPOTIFY ID (spotify_id) — conservative but not silent:
- You do NOT have live Spotify API access. Never invent random-looking 22-character strings; wrong IDs break playback.
- DO include spotify_id when you have a reliable identifier for that exact recording: the 22-character track id, a spotify:track:… URI, or a full https://open.spotify.com/track/… link you know is correct (same recording as "search"). The app extracts the id from URLs.
- If you only know title and artist but have no id or link you trust, omit spotify_id for that song — the app resolves via "search".
- When unsure between including a questionable id or omitting it, omit it.
- The "search" field is always required and is the source of truth for lookup; spotify_id is an optional accelerator when trustworthy.

The "composed" field is the year of composition — use it ONLY when the composer predates the performer by decades. NEVER set "composed" for any living artist or any song written after 1970. If in doubt, omit it.
The "performer" field is for notated/repertory works only: set it to the performing ensemble or soloist when distinct from the composer. The "search" field should include both composer and performer for best lookup results.`

// 0 = pure familiar (exploit liked regions), 100 = pure adventurous (all unexplored)
export type ExploreMode = number

function slotInstructions(mode: ExploreMode, hasLikes: boolean, numSongs: number): string {
  const extra = numSongs > 3 ? ` For songs beyond the first 3, continue the same distribution pattern — vary positions across the space.` : ''
  if (!hasLikes) {
    return `No confirmed likes yet (nothing ★3.5+). All ${numSongs} slots must explore different UNTRIED super-categories — maximize musical distance. All ${numSongs} songs must be by different artists. Never cluster in an area that already got low ratings (★≤2.5) or repeat an artist heard 2+ times without ★4+.`
  }
  if (mode <= 20) {
    return `FAMILIAR MODE: All ${numSongs} slots should be near liked positions (within ~15 coordinate units). Deepen what already works — different songs but same musical neighborhood.`
  }
  if (mode <= 40) {
    return `MOSTLY FAMILIAR: Slot 1 and Slot 2 near liked positions. Slot 3 moderately new territory (20–40 units from nearest liked song).${extra}`
  }
  if (mode <= 60) {
    return `BALANCED: Apply the slot rule — Slot 1 near a liked region, Slot 2 from unmapped territory (≥40 units from all heard), Slot 3 a genuine wild card surprise.${extra}`
  }
  if (mode <= 80) {
    return `MOSTLY ADVENTUROUS: Slot 1 at the edge of liked territory (15–30 units out). Slots 2 and 3 in unexplored regions (≥40 units from all heard songs).${extra}`
  }
  return `ADVENTURE MODE: All ${numSongs} slots in maximally unexplored territory (≥40 units from everything heard). Ignore proximity to liked songs entirely.`
}

/** Recent tracks listed explicitly; older session picks are covered by heardSkip only. */
export const HEARD_RECENT_WINDOW = 12
/** Ratings block shows the tail; older rows omitted to save tokens. */
export const RATINGS_RECENT_WINDOW = 15

/** One played or queued recording — used to forbid repeats in the LLM prompt. */
export interface HeardRecording {
  track: string
  artist: string
  /** Queued or now-playing — not yet in ratings. */
  pending?: boolean
}

/** Canonical "search" shape the LLM should use: "track title" + space + artist. */
export function canonicalSongSearch(track: string, artist: string): string {
  return `${track.trim()} ${artist.trim()}`
}

export function mergeHeardRecordings(recordings: HeardRecording[]): HeardRecording[] {
  const map = new Map<string, HeardRecording>()
  for (const r of recordings) {
    const track = r.track.trim()
    const artist = r.artist.trim()
    if (!track || !artist) continue
    const key = `${track.toLowerCase()}|${artist.toLowerCase()}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { track, artist, pending: r.pending })
    } else if (r.pending) {
      existing.pending = true
    }
  }
  return [...map.values()]
}

/** Anti-duplicate rules for the user prompt — paired with heardSkip pagination each turn. */
export function buildNoDuplicateRulesSection(
  numSongs: number,
  heardSkip: number,
  hasPending: boolean,
): string {
  if (heardSkip === 0 && !hasPending) {
    return (
      `SONG UNIQUENESS RULES (this batch):\n` +
      `- All ${numSongs} songs must be different recordings by different artists.\n` +
      `- No two rows in your JSON may share the same track title + artist.\n\n`
    )
  }

  const lines = [
    `SONG UNIQUENESS RULES — mandatory this turn:`,
    `1. HEARD SESSION uses pagination: heardSkip=${heardSkip} — treat chronological positions 1–${heardSkip} as forbidden (like skipping ${heardSkip} results).`,
    `2. Every "search" must name a recording NOT in those ${heardSkip} heard positions — including older tracks omitted from the list to save tokens.`,
    `3. Duplicate test: same track title + same artist = forbidden — even if wording differs ("Title by Artist" vs "Title Artist"), or if it is a remaster, live take, or alternate mix of the same work.`,
    `4. All ${numSongs} songs this batch must be different recordings from each other AND from every heard/queued track.`,
    `5. A song played earlier this session stays forbidden for the entire session. Five (or fifty) songs later does not clear it.`,
  ]
  if (hasPending) {
    lines.push(`6. PENDING DJ ROWS below are equally forbidden — do not repeat them.`)
  }
  lines.push(
    `${hasPending ? '7' : '6'}. Before returning JSON, cross-check each "search" against heardSkip and the lists below. If you cannot find ${numSongs} genuinely new recordings, return fewer songs — never recycle a heard track.`,
    '',
  )
  return lines.join('\n') + '\n'
}

export function buildHeardRecordingsPromptSection(
  heardSkip: number,
  recentRecordings: HeardRecording[],
  pendingSearches: string[] | undefined,
  numSongs: number,
): string {
  const pending = [...new Set((pendingSearches ?? []).map((s) => s.trim()).filter(Boolean))]
  const rules = buildNoDuplicateRulesSection(numSongs, heardSkip, pending.length > 0)

  if (heardSkip === 0 && !pending.length) {
    return rules
  }

  let out = rules

  if (heardSkip > 0) {
    const olderOmitted = Math.max(0, heardSkip - recentRecordings.length)
    out +=
      `HEARD SESSION (pagination): ${heardSkip} unique recordings heard chronologically. heardSkip=${heardSkip} — do NOT suggest positions 1–${heardSkip}.\n`
    if (olderOmitted > 0) {
      out += `(${olderOmitted} older tracks omitted from list — still forbidden via heardSkip.)\n`
    }
    if (recentRecordings.length) {
      out += `RECENT HEARD (last ${recentRecordings.length} — explicit forbidden searches):\n`
      for (const r of recentRecordings) {
        const tag = r.pending ? ' [queued/now playing]' : ''
        out += `- "${r.track}" by ${r.artist}${tag} → forbidden search: "${canonicalSongSearch(r.track, r.artist)}"\n`
      }
    }
    out += '\n'
  }

  if (pending.length) {
    out +=
      `PENDING DJ ROWS — also forbidden (queued, not yet played):\n` +
      `${pending.map((s) => `- ${s}`).join('\n')}\n\n`
  }

  return out
}

/** Recent artists + saturated acts — keeps the DJ from clustering one neighborhood. */
export function buildSessionDiversitySection(
  sessionHistory: ListenEvent[],
  numSongs: number,
): string {
  if (!sessionHistory.length) return ''

  const artistStats = new Map<string, { count: number; display: string; bestStars: number }>()
  for (const e of sessionHistory) {
    const key = e.artist.trim().toLowerCase()
    if (!key) continue
    const cur = artistStats.get(key) ?? { count: 0, display: e.artist, bestStars: 0 }
    cur.count++
    if (e.stars != null && e.stars > 0) {
      cur.bestStars = Math.max(cur.bestStars, e.stars)
    }
    artistStats.set(key, cur)
  }

  const saturatedArtists = [...artistStats.values()]
    .filter((a) => a.count >= 2 && a.bestStars < 4)
    .sort((a, b) => b.count - a.count)

  let out =
    `CANVAS DIVERSITY — map the musical landscape; do not drill one artist or neighborhood:\n` +
    `- All ${numSongs} songs this batch MUST be by different artists.\n` +
    `- Do not repeat an artist heard 2+ times unless they earned ★4+.\n` +
    `- Recent heard tracks are listed under HEARD SESSION above; maximize distance from heardSkip.\n\n`

  if (saturatedArtists.length) {
    out += 'ARTIST SATURATION (avoid these acts this batch):\n'
    for (const a of saturatedArtists) {
      const best = a.bestStars > 0 ? `★${a.bestStars}` : 'unrated/skipped'
      out += `- ${a.display} (${a.count}× heard, best ${best})\n`
    }
    out += '\n'
  }

  return out
}

export function buildUserPrompt(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode: ExploreMode = 50,
  numSongs = 3,
  treeExplorationSection?: string,
  heardRecordings?: HeardRecording[],
  pendingSearches?: string[],
  heardSkip?: number,
  heardRecent?: HeardRecording[],
): string {
  let prompt = ''

  if (notes?.trim()) {
    prompt += `USER CONSTRAINTS (must be followed for every song): ${notes.trim()}\n\n`
  }

  const mergedHeard = heardRecordings?.length
    ? mergeHeardRecordings(heardRecordings)
    : mergeHeardRecordings(
        sessionHistory.map((e) => ({ track: e.track, artist: e.artist })),
      )
  const skip = heardSkip ?? mergedHeard.length
  const recentHeard = heardRecent?.length
    ? mergeHeardRecordings(heardRecent)
    : mergedHeard.slice(-HEARD_RECENT_WINDOW)
  const pending = [...new Set((pendingSearches ?? []).map((s) => s.trim()).filter(Boolean))]

  // Anti-duplicate rules + heardSkip pagination live in the user prompt (not app-side filtering).
  prompt += buildHeardRecordingsPromptSection(skip, recentHeard, pendingSearches, numSongs)

  if (
    alreadyHeard &&
    alreadyHeard.length > 0 &&
    skip === 0 &&
    pending.length === 0
  ) {
    prompt +=
      `LEGACY HEARD LIST (also forbidden):\n` +
      `${alreadyHeard.map((s) => `- ${s}`).join('\n')}\n\n`
  }

  if (sessionHistory.length > 0) {
    prompt += buildSessionDiversitySection(sessionHistory, numSongs)
  }

  if (priorProfile) {
    prompt += `Taste profile so far:\n${priorProfile}\n\n`
  }

  if (numSongs !== 3) {
    prompt += `Provide exactly ${numSongs} song suggestions this turn.\n\n`
  }

  if (treeExplorationSection) {
    prompt += `${treeExplorationSection}\n\n`
  }

  if (sessionHistory.length === 0 && !priorProfile) {
    if (notes?.trim()) {
      prompt += `FIRST TURN — all ${numSongs} songs must fit the user constraints. Pick well-known, on-target exemplars (not adjacent genres). Tag category_paths from the tree when provided.\n`
    } else if (treeExplorationSection) {
      prompt += `FIRST TURN — follow the 20Q category tree instructions above. Still assign coords for the map.\n`
    } else {
      prompt += `FIRST TURN — no history yet. Apply the first-turn rule: ${numSongs} songs from maximally distant parts of the coordinate space. You choose which musical areas to explore.\n`
    }
    return prompt
  }

  if (sessionHistory.length > 0) {
    const total = sessionHistory.length
    const shown = sessionHistory.slice(-RATINGS_RECENT_WINDOW)
    const omitted = Math.max(0, total - shown.length)
    const lines = shown.map(e => {
      const pos = e.coords ? ` @ (${Math.round(e.coords.x)}, ${Math.round(e.coords.y)})` : ''
      const paths = e.categoryPaths?.length
        ? ` {${e.categoryPaths.map(p => `${p.dimension}/${p.super}${p.leaf ? `/${p.leaf}` : ''}`).join(', ')}}`
        : ''
      const rating = e.stars !== null && e.stars !== undefined ? `★${e.stars}` : '(skipped)'
      return `- "${e.track}" by ${e.artist}: ${rating}${paths}${pos}`
    }).join('\n')
    prompt += `Ratings this session (${total} total; heardSkip=${skip}; showing last ${shown.length}`
    if (omitted > 0) prompt += `; ${omitted} oldest omitted to save tokens`
    prompt += `):\n${lines}\n`
    if (omitted > 0) {
      prompt += `(${omitted} older ratings omitted — those tracks remain forbidden via heardSkip=${skip}.)\n`
    }
    prompt += '\n'
  }

  const hasLikes = sessionHistory.some(e => (e.stars ?? 0) >= 3.5) ||
    (priorProfile ? /LIKED:\s*(?!\[none|\[no confirmed|\[nothing)/i.test(priorProfile) : false)

  if (notes?.trim()) {
    prompt += `CHANNEL LOCK: All ${numSongs} songs MUST satisfy the user constraints above. Stay within the requested style, era, and region — vary artists and specific tracks, not the genre. Do not use wild-card slots to leave the channel.\n`
  } else if (!treeExplorationSection) {
    prompt += slotInstructions(mode, hasLikes, numSongs)
  } else if (hasLikes) {
    prompt += `Apply slot rules where compatible with the 20Q tree instructions above — Slot 1 near liked super-categories, Slot 2 from fresh supers, Slot 3 a wild card within the tree.\n`
  } else {
    const { disliked, saturated, all } = deprioritizedSupersFromHistory(sessionHistory)
    prompt += `NO CONFIRMED LIKES (★3.5+): Do not infer taste from low-rated rows. ★3 is neutral, not a like. Each batch must open NEW tree supers — never stack 2+ picks in the same super-category until the listener rates ★3.5+.\n`
    if (all.length) {
      const parts: string[] = []
      if (disliked.length) parts.push(`disliked: ${disliked.join(', ')}`)
      if (saturated.length) parts.push(`saturated (2+ visits, no ★3.5+): ${saturated.join(', ')}`)
      prompt += `Deprioritize these supers: ${parts.join('; ')}.\n`
    }
    prompt += `Continue 20Q exploration per the tree instructions above — prioritize dimensions and supers NOT yet tried.\n`
  }

  if (notes?.trim()) {
    prompt += `\n\nREMINDER — all songs must satisfy: ${notes.trim()}. Do not hallucinate dates or genres to fit this constraint; omit a slot instead.`
  }

  if (skip > 0 || pending.length > 0) {
    prompt +=
      `\nFINAL CHECK (SONG UNIQUENESS RULES): Re-read every "search" in your JSON — heardSkip=${skip}` +
      `${pending.length ? '; also check PENDING DJ ROWS' : ''}. ` +
      `Zero duplicates. Return fewer songs rather than repeat.\n`
  }

  return prompt
}

type LlmPromptContext = {
  heardRecordings?: HeardRecording[]
  heardSkip?: number
  heardRecent?: HeardRecording[]
  pendingSearches?: string[]
}

async function askAnthropic(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number,
  treeExplorationSection?: string,
  promptContext?: LlmPromptContext,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildUserPrompt(
          sessionHistory,
          priorProfile,
          notes,
          alreadyHeard,
          mode,
          numSongs,
          treeExplorationSection,
          promptContext?.heardRecordings,
          promptContext?.pendingSearches,
          promptContext?.heardSkip,
          promptContext?.heardRecent,
        ),
      }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic responded with ${res.status}`)
  const data = await res.json()
  return data.content[0].text
}

async function askOpenAI(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number,
  treeExplorationSection?: string,
  promptContext?: LlmPromptContext,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(
            sessionHistory,
            priorProfile,
            notes,
            alreadyHeard,
            mode,
            numSongs,
            treeExplorationSection,
            promptContext?.heardRecordings,
            promptContext?.pendingSearches,
            promptContext?.heardSkip,
            promptContext?.heardRecent,
          ),
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI responded with ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function askDeepSeek(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number,
  treeExplorationSection?: string,
  promptContext?: LlmPromptContext,
): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(
            sessionHistory,
            priorProfile,
            notes,
            alreadyHeard,
            mode,
            numSongs,
            treeExplorationSection,
            promptContext?.heardRecordings,
            promptContext?.pendingSearches,
            promptContext?.heardSkip,
            promptContext?.heardRecent,
          ),
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek responded with ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function askGemini(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number,
  treeExplorationSection?: string,
  promptContext?: LlmPromptContext,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          parts: [{
            text: buildUserPrompt(
              sessionHistory,
              priorProfile,
              notes,
              alreadyHeard,
              mode,
              numSongs,
              treeExplorationSection,
              promptContext?.heardRecordings,
              promptContext?.pendingSearches,
              promptContext?.heardSkip,
              promptContext?.heardRecent,
            ),
          }],
        }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini responded with ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

const MAX_LLM_ATTEMPTS = 2

export async function getNextSongQuery(
  sessionHistory: ListenEvent[],
  provider: LLMProvider = DEFAULT_LLM_PROVIDER,
  notes?: string,
  priorProfile?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number,
  treeExplorationSection?: string,
  heardRecordings?: HeardRecording[],
  pendingSearches?: string[],
  heardSkip?: number,
  heardRecent?: HeardRecording[],
): Promise<{ songs: SongSuggestion[]; profile?: string; suggestedArtists: string[] }> {
  const promptContext: LlmPromptContext = {
    heardRecordings,
    heardSkip,
    heardRecent,
    pendingSearches,
  }
  const ask = () => {
    switch (provider) {
      case 'openai': return askOpenAI(sessionHistory, priorProfile, notes, alreadyHeard, mode, numSongs, treeExplorationSection, promptContext)
      case 'deepseek': return askDeepSeek(sessionHistory, priorProfile, notes, alreadyHeard, mode, numSongs, treeExplorationSection, promptContext)
      case 'gemini': return askGemini(sessionHistory, priorProfile, notes, alreadyHeard, mode, numSongs, treeExplorationSection, promptContext)
      default: return askAnthropic(sessionHistory, priorProfile, notes, alreadyHeard, mode, numSongs, treeExplorationSection, promptContext)
    }
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
    let raw: string
    try {
      raw = await ask()
      console.log('LLM raw response', raw)
    } catch (err) {
      lastError = err as Error
      if (attempt === MAX_LLM_ATTEMPTS - 1) throw err
      continue
    }
    try {
      const result = parseLLMResponse(raw)
      return result
    } catch (err) {
      lastError = err as Error
      if (attempt === MAX_LLM_ATTEMPTS - 1) throw err
    }
  }
  throw lastError ?? new Error('LLM query failed after all attempts')
}

/**
 * Parse multiple year constraints (union). Channel time periods are joined with " and "
 * (e.g. "1990s and 2000s and 2010s and after 2020"); each segment is parsed with {@link parseYearRange}.
 * If no segment matches, falls back to parsing the full string once.
 */
export function parseYearRanges(notes: string): { min: number; max: number }[] | null {
  const s = notes.trim()
  if (!s) return null
  const ranges: { min: number; max: number }[] = []
  for (const part of s.split(/\s+and\s+/i)) {
    const r = parseYearRange(part.trim())
    if (r) ranges.push(r)
  }
  if (ranges.length > 0) return ranges
  const single = parseYearRange(s)
  return single ? [single] : null
}

/**
 * Parse a loose year-range string into {min, max} bounds (both inclusive).
 * Handles: "1945-1950", "1940s", "after 2020", "before 1960", bare "1965".
 * Returns null if no year range is detectable (e.g. "baroque era").
 */
export function parseYearRange(notes: string): { min: number; max: number } | null {
  const s = notes.toLowerCase()
  // "1945-1950" or "1945–1950"
  const rangeM = s.match(/\b(\d{4})\s*[-–]\s*(\d{4})\b/)
  if (rangeM) return { min: parseInt(rangeM[1]), max: parseInt(rangeM[2]) }
  // "1940s"
  const decadeM = s.match(/\b(\d{3})0s\b/)
  if (decadeM) { const d = parseInt(decadeM[1] + '0'); return { min: d, max: d + 9 } }
  // "after 2020" / "from 2020" / "post-2020"
  const afterM = s.match(/\b(?:after|from|since|post[-\s]?)(\d{4})\b/)
  if (afterM) return { min: parseInt(afterM[1]), max: 9999 }
  // "before 1960" / "pre-1960" / "until 1960"
  const beforeM = s.match(/\b(?:before|until|up\s*to|pre[-\s]?)(\d{4})\b/)
  if (beforeM) return { min: 0, max: parseInt(beforeM[1]) }
  // bare 4-digit year
  const yearM = s.match(/\b(\d{4})\b/)
  if (yearM) { const y = parseInt(yearM[1]); if (y >= 1400 && y <= 2100) return { min: y, max: y } }
  return null
}

function findJsonObject(text: string): { payload: string; start: number; end: number } {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found')
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { payload: text.slice(start, i + 1), start, end: i }
    }
  }
  throw new Error('JSON object not terminated')
}

function rawYoutubeVideoIdFromRow(row: Record<string, unknown>): string | undefined {
  for (const k of ['youtubeVideoId', 'youtube_video_id', 'youtube_url', 'youtubeUrl'] as const) {
    const v = row[k]
    if (typeof v !== 'string' || !v.trim()) continue
    const id = extractYoutubeVideoIdLoose(v.trim())
    if (id) return id
  }
  return undefined
}

export function parseSuggestedArtistsRaw(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (!t || t.length > 160) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= 16) break
  }
  return out
}

function parseCoords(raw: unknown): { x: number; y: number; z?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const x = typeof c.x === 'number' ? c.x : typeof c.x === 'string' ? parseFloat(c.x) : NaN
  const y = typeof c.y === 'number' ? c.y : typeof c.y === 'string' ? parseFloat(c.y) : NaN
  if (isNaN(x) || isNaN(y)) return undefined
  const zRaw = typeof c.z === 'number' ? c.z : typeof c.z === 'string' ? parseFloat(c.z) : NaN
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
    ...(isNaN(zRaw) ? {} : { z: Math.min(100, Math.max(0, zRaw)) }),
  }
}

function parseLLMResponse(raw: string): { songs: SongSuggestion[]; profile?: string; suggestedArtists: string[] } {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const { payload, start, end } = findJsonObject(cleaned)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch (err) {
    console.warn('LLM JSON parse failed', {
      error: (err as Error).message,
      snippet: cleaned.slice(Math.max(0, start - 40), Math.min(cleaned.length, end + 40)),
    })
    throw err
  }

  // New format: {songs: [{search, reason, category, spotify_id, youtube_url, coords}, ...], profile}
  if (Array.isArray(parsed.songs)) {
    type LLMRow = {
      search: string
      reason: string
      category?: string
      spotify_id?: string
      spotifyId?: string
      youtube_url?: string
      youtubeUrl?: string
      youtube_video_id?: string
      youtubeVideoId?: string
      coords?: unknown
      composed?: unknown
      performer?: unknown
    }
    const rawSpotifyIdFromRow = (row: Record<string, unknown>): string | undefined => {
      for (const k of ['spotifyId', 'spotify_id', 'spotify_track_id'] as const) {
        const v = row[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
        if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
      }
      return undefined
    }
    const songs = parsed.songs
      .filter((s: unknown): s is LLMRow => {
        const c = s as Record<string, unknown>
        return Boolean(s && typeof s === 'object' && typeof c.search === 'string' && typeof c.reason === 'string')
      })
      .map((s: LLMRow) => {
        const row = s as unknown as Record<string, unknown>
        const categoryPaths = parseCategoryPathsFromRaw(row.category_paths)
        const category =
          typeof s.category === 'string' && s.category.trim()
            ? s.category
            : pathsToCategoryLabel(categoryPaths)
        return {
        search: s.search,
        reason: s.reason.replace(/^Slot\s*\d+\s*[—–-]\s*/i, '').replace(/^Slot\s*\d+:\s*/i, ''),
        category,
        categoryPaths: categoryPaths.length ? categoryPaths : undefined,
        spotifyId: normalizeSpotifyTrackId(rawSpotifyIdFromRow(row)),
        youtubeVideoId: rawYoutubeVideoIdFromRow(s as unknown as Record<string, unknown>),
        coords: parseCoords(s.coords),
        composed: typeof s.composed === 'number' && Number.isFinite(s.composed) ? s.composed : undefined,
        performer: typeof s.performer === 'string' && s.performer.trim() ? s.performer.trim() : undefined,
      }})
      .filter((song: SongSuggestion): song is SongSuggestion => Boolean(song.search && song.reason))
    const chosen = songs.slice(0, 10)  // allow up to 10; caller requested numSongs
    const suggestedArtists = parseSuggestedArtistsRaw(
      parsed.suggested_artists ?? parsed.suggestedArtists
    )
    if (songs.length > 0) {
      const withId = chosen.filter(s => s.spotifyId).length
      const withYt = chosen.filter(s => s.youtubeVideoId).length
      console.log(
        `LLM songs: ${chosen.length} tracks, ${withId} with spotifyId, ${withYt} with youtubeVideoId (enriched from cache), ${chosen.length - withId - withYt} search-only`
      )
      console.log(
        chosen.map((s: SongSuggestion) => ({
          search: s.search,
          coords: s.coords,
          ...(s.spotifyId ? { spotifyId: s.spotifyId } : {}),
          ...(s.youtubeVideoId ? { youtubeVideoId: s.youtubeVideoId } : {}),
          ...(s.composed != null ? { composed: s.composed } : {}),
        }))
      )
      return {
        songs: chosen,
        profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
        suggestedArtists,
      }
    }
    if (suggestedArtists.length > 0 || typeof parsed.profile === 'string') {
      return {
        songs: [],
        profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
        suggestedArtists,
      }
    }
  }

  // Old format fallback: {search, reason, profile}
  if (typeof parsed.search === 'string' && typeof parsed.reason === 'string') {
    const rawSingle =
      typeof parsed.spotifyId === 'string'
        ? parsed.spotifyId.trim()
        : typeof parsed.spotify_id === 'string'
          ? parsed.spotify_id.trim()
          : undefined
    const spotifyId = normalizeSpotifyTrackId(rawSingle)
    const single: SongSuggestion = {
      search: parsed.search,
      reason: parsed.reason,
      spotifyId,
      youtubeVideoId: rawYoutubeVideoIdFromRow(parsed),
      coords: parseCoords(parsed.coords),
    }
    const suggestedArtists = parseSuggestedArtistsRaw(
      parsed.suggested_artists ?? parsed.suggestedArtists
    )
    return {
      songs: [single],
      profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
      suggestedArtists,
    }
  }

  throw new Error('LLM response format not recognized')
}

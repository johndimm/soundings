# Soundings User Guide

Soundings is a music discovery app that uses an AI DJ to learn your taste and find music you don't know yet. It works in two modes — pick the one that suits you:

| Mode | Requirement | Playback |
|------|-------------|---------|
| **Spotify** | Spotify Premium account | Full audio, seekable |
| **YouTube** | No account needed | Embedded YouTube video |

---

## How it works, in one paragraph

When you open Soundings, the AI DJ picks songs from very different parts of the musical map and lines them up. As you listen and react, the DJ builds a picture of your taste and uses it to choose what comes next. The more you interact, the more accurate it gets. Everything is saved in your browser — no server account needed.

---

## Choosing a mode

On the login page you'll see two options:

- **Spotify** — logs you in with OAuth and streams audio through the Spotify Web Playback SDK. Requires a Premium subscription.
- **YouTube** — goes straight to the player with no login. Songs play as embedded YouTube videos.

Both modes use the same AI DJ and channels system. You can maintain independent channels in each mode.

### YouTube quota

The YouTube Data API has a daily search quota. The free tier allows roughly **100 song lookups per day**. When the quota is exhausted the player shows a yellow banner and the DJ will hold suggestions until the next day (quota resets at midnight Pacific time). The **Status** page shows how many searches remain.

---

## The player

[Screenshot: the full player — album art on the left, sidebar on the right]

### Album art panel (Spotify mode)

The left side shows the album art, which slowly pans across the image while a song plays.

- **Click anywhere on the art** to pause or resume playback.
- **▶ / ⏸ indicator** — a small icon in the top-right corner tells you at a glance whether the song is playing or paused.
- **Hover** over the art to see "play" or "pause" as text over a dim overlay.

[Screenshot: album art with ▶ indicator in top-right corner]

### YouTube video panel (YouTube mode)

In YouTube mode the album art panel is replaced by an embedded YouTube video. The video autoplays when a song loads. Use the YouTube player controls (volume, fullscreen, etc.) directly within the embed.

- The rating slider and Next button work the same as in Spotify mode.
- Because playback is inside an iframe, the app's seek bar reflects the elapsed time but does not control the YouTube player directly.

### Track info

At the bottom of the art panel:

- **Song title** — click it to open the track in Spotify or YouTube (depending on mode).
- **Artist** and **year** — for contemporary recordings this is the release year; for classical music and jazz standards it shows the year of composition (e.g. "1791" for Mozart, not the CD release date).
- **DJ's reason** — a one-sentence note explaining why this song was picked (slot role, musical position, connection to your history).

[Screenshot: track info area — title, artist, year, reason]

### Progress bar

Below the track info is a scrubber. Drag it to seek. If you drag it all the way to the end, the app advances to the next song (same as pressing Next).

### Next button

Press **Next** to move on. The current song fades out over ~700 ms and the next one begins.

- If you haven't rated the current song, pressing Next logs it automatically: the percentage listened is used as the rating.
- If you played to the end (song finished naturally), it's logged as 100%.

---

## Rating a track

Rating is how you teach the DJ your taste. A higher rating means "I liked this"; a lower rating means "not for me." Ratings affect what the DJ suggests next.

There are **four ways** to rate:

### 1. The vertical slider (on the album art)

[Screenshot: vertical slider on right side of album art, showing "72%" and "rated" in green]

A vertical slider lives on the right edge of the album art. Drag it up to say you liked the song, down to say you didn't. The percentage shown is the rating. When you release, the rating is locked in and "rated" turns green. You can adjust it multiple times — only the last value counts.

### 2. Pressing Next without rating

If you just press Next without using the slider, the app rates the song automatically based on how much of it you listened to:

> `rating = (position / duration) × 100`

So if you skip after 30% of the song, it's recorded as a 30% rating. If you let it play to the end, it's 100%.

### 3. Playing a song to completion

The song advances automatically when the playback position reaches 98% of the duration. This counts as a 100% rating.

### 4. Editing past ratings in the Heard list

[Screenshot: Heard section showing a past song with its slider]

In the right panel under **Heard**, every song you've listened to has a small horizontal slider. Drag it left or right to revise the rating after the fact. The change is applied immediately to the session history the DJ uses — no need to save.

The label next to each entry shows:
- **liked** (green) — ≥ 70%
- **ok** (neutral) — 40–69%
- **nope** (red) — < 40%

---

## How the DJ interprets ratings

The DJ doesn't just see the number — it maps it to a **reaction**:

| Rating | Reaction | Meaning to the DJ |
|--------|----------|-------------------|
| ≥ 80% | more-from-artist | Loved it. Slot 1 next round may be this artist or a close peer. |
| 31–79% | move-on | Fine, but don't push it. Explore nearby territory. |
| ≤ 30% | not-now | Skip this musical territory. Not the artist — just this sound. |

A dislike is about the sonic character of the track, not a ban on the artist. The same artist might have very different songs that remain fair game.

---

## The sidebar

[Screenshot: full sidebar showing Up next, profile, sliders, filters, Heard list]

The sidebar to the right of the album art is divided into sections from top to bottom.

### Up next

Shows the songs queued for playback. Click any song to jump to it immediately. Click **×** next to a song to remove it from the queue.

Below the confirmed queue, a **"DJ is thinking…"** section may appear, showing song names and reasons the DJ has suggested but hasn't yet resolved to tracks. These become clickable entries once the lookup finishes.

[Screenshot: Up next section with one confirmed track and two pending suggestions below]

### What I know about you (taste profile)

The DJ maintains a short paragraph describing what it has observed about your taste — genres, eras, moods, energy levels. This updates after each rating.

Click **edit** to manually revise the profile. This is useful if it's wrong, or if you want to steer the DJ in a different direction by editing it directly.

[Screenshot: taste profile section in both read and edit mode]

### Discovery slider

[Screenshot: Discovery slider set to "Mostly new"]

Controls how adventurous the DJ is:

- **Familiar** (left) — the DJ stays close to regions of the map you've already liked
- **Adventurous** (right) — the DJ prioritizes unexplored territory and surprises

The label updates as you move the slider: Familiar → Mostly familiar → Balanced → Mostly new → Adventurous.

The slider takes effect on the **next LLM call**, not the current queue. When you change it (and other settings), a small **"· queued"** tag appears in amber next to the label, indicating the change is staged and will be sent with the next request.

### Genres

[Screenshot: genre chips with "Jazz" and "Electronic" selected]

Click genre chips to constrain the DJ to specific genres. Multiple selections are OR'd — any of the selected genres is fair game.

The free-text field below the chips lets you describe a style in your own words: e.g. *"dreamy shoegaze"*, *"Nordic folk"*, *"dark ambient"*.

### Region

[Screenshot: region chips with "West Africa" selected]

Constrains suggestions to music from a specific part of the world. Useful if you want to explore a musical tradition geographically.

### Time period

A free-text field. Write anything: *"1970s"*, *"after 2020"*, *"baroque era"*, *"pre-war blues"*. The DJ follows this strictly.

### Popularity

[Screenshot: popularity slider set to "Hidden gems"]

Controls how mainstream the suggestions are:
- **Obscure / Hidden gems** — avoid anything well-known
- **Mixed** (middle, default) — no constraint
- **Mainstream** — prefer recognizable songs

### Tell the DJ

A free-text note sent directly to the DJ with every request. Use it for one-off instructions: *"nothing with electric guitar right now"*, *"upbeat only"*, *"I'm studying, keep it calm"*.

Like other settings, changes here show **"· queued"** until they're sent.

### Heard

[Screenshot: Heard section with three songs, sliders, checkboxes, and "Select all / Delete 2"]

The full listen history for the current channel, newest first. Each entry shows:
- Album art thumbnail
- Track name and artist
- A rating slider with label (liked / ok / nope) and percentage

**Playing a past song:** click the row to play it again.

**Deleting entries:** check one or more entries using the checkboxes on the left, then click **Delete N** to remove them. Removing entries also removes them from the session history the DJ uses — useful for resetting a direction that isn't working.

**Select all / Deselect all:** toggles all checkboxes at once.

---

## Channels

[Screenshot: channel tab bar with "Jazz & Soul", "Electronic", "+ New"]

Channels let you maintain separate listening sessions with completely independent histories, profiles, and settings. **Make a channel for every mood** — morning focus, late-night ambient, work, workout, a deep dive into Brazilian music — and switch between them without losing your place.

### What a channel stores

Each channel saves independently:
- The full listen history (Heard)
- The session history sent to the DJ
- The AI taste profile
- All settings: Discovery, Genres, Region, Time period, Popularity, Tell the DJ
- Where you left off on the current song (playback position)

### Switching channels

Click a channel tab to switch to it. Your current session is automatically saved before switching. The new channel loads with its own history and settings.

**Playback position is remembered per channel.** When you return to a channel, the current song resumes where you left off instead of starting at the beginning. You can jump from channel to channel **without delay or break** in your flow — no reset, no hunting for the right moment. Treat each tab like a separate radio tuned to a mood.

### Creating a channel

Click **+ New** at the right of the tab bar. A new channel is created immediately with a blank history and default settings.

### Renaming a channel

Click the name of the **active** channel tab. It becomes an editable text field. Press Enter to save, Escape to cancel. Channels can also be auto-named based on the genres most heard in them (e.g. "Jazz & Soul").

### Deleting a channel

Click the **×** on a channel tab. You cannot delete the last remaining channel.

---

## The taste space

Soundings treats music as a **high-dimensional space** — not just genre tags. We know many things about songs: writers, performers, instruments, recording date, where it was recorded, and how it is categorized. **All of those attributes can feed into a notion of distance**: similar songs are **close**; different songs are farther apart.

If you like a song, the DJ can look for **nearby** music you have not heard yet. If you dislike something, it can learn to **avoid that general region** of the space — not by banning one label, but by steering away from that neighborhood of sound.

**Exploring your taste** means exploring the space: taking **semi-random shots** into territory you have not discovered. On this model, **category is only one of many facts** the system can use; the rest of the picture comes from everything else we know about the track.

---

## The map

[Screenshot: the 2D music map — green (liked), red (disliked), grey (not-now), genre labels]

The **Map** link opens a separate view — a **simple 2D projection** of that idea (easy to see on screen; the full picture is much richer than two axes). It shows all the songs you've heard plotted in a plane:

- **X-axis**: acoustic/live → electronic/synthetic
- **Y-axis**: calm/sparse → intense/energetic

Each dot is a song. Colored labels mark broad genre regions. The map is for exploration and curiosity — it shows where your taste clusters and what territory you haven't explored yet.

---

## Status and rate limiting

[Screenshot: yellow banner showing "Spotify unavailable until 8:14 PM — Try now | stats"]

Soundings calls both a music service (Spotify or YouTube) and an AI service. Occasionally:

- **Spotify rate limiting** — Spotify has throttled the app. A yellow banner appears at the top with an estimated wait time.
  - Click **Try now** to immediately ping Spotify. If it responds successfully, the ban is cleared and music resumes.
  - Click **stats** to see a detailed breakdown of API call counts.

- **YouTube quota** — the YouTube Data API has a daily search limit (roughly 100 lookups/day on the free tier). When it's exhausted the player pauses new suggestions. The quota resets at midnight Pacific time.
  - The **Status** page has a **Test YouTube search now** button that shows how many searches remain today.

- **"Asking the DJ…"** spinner — the AI is generating suggestions. This is normal; it takes a few seconds.

- **"LLM may be unavailable. Will retry."** — the AI service returned an error. The app will automatically retry after 30 seconds.

---

## Keyboard and mobile

- **Click album art** — play/pause
- **Tap progress bar end** — advance to next song
- **Pinch to zoom** — supported on mobile; useful in portrait mode to reveal the sidebar

---

## Settings that aren't sent immediately

The Discovery slider, Genres, Region, Time period, and Tell the DJ field all show a small **"· queued"** indicator in amber when you've changed them but the change hasn't been sent to the DJ yet. The change goes out with the next natural LLM call — you don't need to do anything to trigger it.

[Screenshot: "Discovery · queued" label in amber]

---

## LLM provider

In the header, a dropdown lets you choose the AI model powering the DJ:

- **DeepSeek** (default) — fast and accurate
- **Claude** (Anthropic) — strong musical reasoning
- **GPT-4o** (OpenAI)
- **Gemini** (Google)

Switching providers mid-session is fine — the session history is passed to whichever model is active.

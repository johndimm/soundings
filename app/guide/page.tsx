'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import AppHeader from '@/app/components/AppHeader'

export default function GuidePage() {
  const lightboxRef = useRef<HTMLDivElement>(null)
  const lightboxImageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const lightbox = lightboxRef.current
    const lightboxImage = lightboxImageRef.current
    if (!lightbox || !lightboxImage) return

    function closeLightbox() {
      if (!lightbox || !lightboxImage) return
      lightbox.classList.remove('open')
      lightbox.setAttribute('aria-hidden', 'true')
      lightboxImage.removeAttribute('src')
      lightboxImage.alt = ''
    }

    const zoomables = document.querySelectorAll<HTMLImageElement>('.screenshot img.zoomable')
    const handlers: Array<{ el: HTMLImageElement; fn: () => void }> = []
    zoomables.forEach(img => {
      const fn = () => {
        lightboxImage.src = img.src
        lightboxImage.alt = img.alt
        lightbox.classList.add('open')
        lightbox.setAttribute('aria-hidden', 'false')
      }
      img.addEventListener('click', fn)
      handlers.push({ el: img, fn })
    })

    const onClose = () => closeLightbox()
    const onLightboxClick = (e: MouseEvent) => {
      if (e.target === lightbox) closeLightbox()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox()
    }

    const closeBtn = lightbox.querySelector<HTMLButtonElement>('.lightbox-close')
    closeBtn?.addEventListener('click', onClose)
    lightbox.addEventListener('click', onLightboxClick)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      handlers.forEach(({ el, fn }) => el.removeEventListener('click', fn))
      closeBtn?.removeEventListener('click', onClose)
      lightbox.removeEventListener('click', onLightboxClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />
      <div className="border-b border-zinc-200 bg-white">
        <div className="max-w-[800px] mx-auto px-4 pt-4 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/soundings.png" alt="Soundings" className="w-full h-auto object-contain object-left" />
        </div>
      </div>
      <div className="border-b border-zinc-200 bg-zinc-50">
        <div className="max-w-[800px] mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-zinc-500">More:</span>
          <Link href="/journal" className="text-zinc-700 hover:text-black underline underline-offset-2">
            Journal
          </Link>
          <Link href="/prompt" className="text-zinc-700 hover:text-black underline underline-offset-2">
            Prompt
          </Link>
        </div>
      </div>
      <style>{GUIDE_CSS}</style>
      <div className="guide-body" dangerouslySetInnerHTML={{ __html: GUIDE_CONTENT }} />
      <div className="lightbox" id="lightbox" aria-hidden="true" ref={lightboxRef}>
        <button className="lightbox-close" aria-label="Close image">×</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={lightboxImageRef} alt="" />
      </div>
    </div>
  )
}

const GUIDE_CSS = `
  .guide-body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    color: #444;
    line-height: 1.7;
    font-size: 15px;
  }
  .guide-body a { color: #1db954; text-decoration: none; }
  .guide-body a:hover { text-decoration: underline; }
  .guide-body h1 { color: #1db954; font-size: 2rem; margin-bottom: 0.25rem; }
  .guide-body .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 2.5rem; }
  .guide-body h2 {
    color: #111;
    font-size: 1.2rem;
    border-bottom: 1px solid #e5e5e5;
    padding-bottom: 0.4rem;
    margin-top: 3rem;
    margin-bottom: 1rem;
  }
  .guide-body h3 {
    color: #1db954;
    font-size: 0.95rem;
    font-weight: 600;
    margin-top: 1.8rem;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .guide-body p { margin: 0.6rem 0 1rem; color: #444; }
  .guide-body ul, .guide-body ol { padding-left: 1.4rem; margin: 0.5rem 0 1rem; }
  .guide-body li { margin: 0.35rem 0; color: #444; }
  .guide-body strong { color: #111; }
  .guide-body em { color: #666; font-style: italic; }
  .guide-body code {
    background: #f3f4f6;
    border: 1px solid #e5e5e5;
    padding: 0.1em 0.4em;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.85em;
    color: #059669;
  }
  .guide-body hr { border: none; border-top: 1px solid #e5e5e5; margin: 2.5rem 0; }
  .guide-body .quickstart {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 10px;
    padding: 1.4rem 1.6rem;
    margin: 1.5rem 0 2.5rem;
  }
  .guide-body .quickstart-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #1db954;
    font-weight: 700;
    margin-bottom: 0.6rem;
  }
  .guide-body .quickstart p { color: #444; margin: 0.4rem 0; }
  .guide-body .quickstart strong { color: #111; }
  .guide-body blockquote {
    margin: 1rem 0;
    padding: 0.8rem 1.2rem;
    background: #f9fafb;
    border-left: 3px solid #1db954;
    border-radius: 0 6px 6px 0;
    color: #555;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9em;
  }
  .guide-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0 1.5rem;
    font-size: 0.9em;
  }
  .guide-body th {
    text-align: left;
    color: #666;
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e5e5e5;
  }
  .guide-body td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #f0f0f0;
    color: #444;
    vertical-align: top;
  }
  .guide-body td:first-child { color: #111; font-weight: 500; white-space: nowrap; }
  .guide-body td code { font-size: 0.82em; }
  .guide-body tr:last-child td { border-bottom: none; }
  .guide-body figure.screenshot { margin: 1rem 0 1.5rem; }
  .guide-body .screenshot img {
    display: block;
    width: auto;
    max-width: 100%;
    border-radius: 12px;
    border: 1px solid #e5e5e5;
    background: #f5f5f5;
    box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  }
  .guide-body .screenshot img.zoomable { cursor: zoom-in; }
  .guide-body .img-album-indicator { width: 360px; }
  .guide-body .img-track-info { width: 304px; }
  .guide-body .img-rating-slider { width: 53px; }
  .guide-body .screenshot figcaption {
    margin-top: 0.55rem;
    color: #888;
    font-size: 0.82rem;
    font-style: italic;
  }
  .guide-body .toc {
    background: #f9fafb;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1.2rem 1.5rem;
    margin: 2rem 0 2.5rem;
  }
  .guide-body .toc-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    margin-bottom: 0.75rem;
  }
  .guide-body .toc ol { margin: 0; padding-left: 1.2rem; }
  .guide-body .toc li { margin: 0.25rem 0; font-size: 0.9rem; }
  .guide-body .toc a { color: #555; }
  .guide-body .toc a:hover { color: #1db954; }
  .pill {
    display: inline-block;
    padding: 0.15em 0.55em;
    border-radius: 999px;
    font-size: 0.75em;
    font-weight: 600;
    vertical-align: middle;
    margin: 0 0.1em;
  }
  .pill-green { background: #dcfce7; color: #15803d; }
  .pill-red   { background: #fee2e2; color: #b91c1c; }
  .pill-gray  { background: #f4f4f5; color: #52525b; }
  .pill-amber { background: #fef3c7; color: #b45309; }
  .lightbox {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: rgba(0, 0, 0, 0.88);
    z-index: 9999;
    cursor: zoom-out;
  }
  .lightbox.open { display: flex; }
  .lightbox img {
    max-width: min(96vw, 1600px);
    max-height: 92vh;
    width: auto;
    height: auto;
    border-radius: 12px;
    border: 1px solid #2a2a2a;
    box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    background: #0a0a0a;
  }
  .lightbox-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    color: #bbb;
    font-size: 1.6rem;
    line-height: 1;
    background: transparent;
    border: none;
    cursor: pointer;
  }
`

const GUIDE_CONTENT = `
<h1>Soundings</h1>
<p class="subtitle">Help</p>

<p>Soundings is a music discovery app that uses an AI DJ to learn your taste and find music you don't know yet. It works in two modes — pick the one that suits you:</p>

<table>
  <thead><tr><th>Mode</th><th>Requirement</th><th>Playback</th></tr></thead>
  <tbody>
    <tr><td><strong>Spotify</strong></td><td>Spotify Premium account</td><td>Full audio, seekable</td></tr>
    <tr><td><strong>YouTube</strong></td><td>No account needed</td><td>Embedded YouTube video</td></tr>
  </tbody>
</table>

<div class="quickstart">
  <div class="quickstart-label">Quick start</div>
  <p>All you really need is the <strong>Next button</strong>. Press it when you hear something you don't like — the song gets no stars. If you like it, give it stars before pressing Next. The more you rate, the more precisely the DJ learns your taste.</p>
  <p>Everything else is optional: the controls on the Channels page let you give hints to speed the process up.</p>
</div>

<div class="toc">
  <div class="toc-title">Contents</div>
  <ol>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#modes">Choosing a mode</a></li>
    <li><a href="#player">The player</a></li>
    <li><a href="#rating">Rating a track</a></li>
    <li><a href="#reactions">How the DJ interprets ratings</a></li>
    <li><a href="#sidebar">The sidebar</a></li>
    <li><a href="#channels">Channels</a></li>
    <li><a href="#taste-space">The taste space</a></li>
    <li><a href="#map">The map</a></li>
    <li><a href="#status">Status and rate limiting</a></li>
    <li><a href="#mobile">Mobile</a></li>
    <li><a href="#provider">LLM provider</a></li>
  </ol>
</div>

<hr>

<h2 id="how-it-works">How it works</h2>

<p>When you open Soundings, the AI DJ picks songs from very different parts of the musical map and lines them up. As you listen and rate, the DJ builds a picture of your taste and uses it to choose what comes next. The more you interact, the more accurate it gets. Everything is saved in your browser — no server account needed.</p>

<hr>

<h2 id="modes">Choosing a mode</h2>

<p>On the login page you'll see two options:</p>
<ul>
  <li><strong>Spotify</strong> — logs you in with OAuth and streams audio through the Spotify Web Playback SDK. Requires a Premium subscription.</li>
  <li><strong>YouTube</strong> — goes straight to the player with no login. Songs play as embedded YouTube videos.</li>
</ul>
<p>Both modes use the same AI DJ and channels system. You can maintain independent channels in each mode.</p>

<h3>YouTube quota</h3>
<p>The YouTube Data API has a daily search quota. The free tier allows roughly <strong>100 song lookups per day</strong>. When the quota is exhausted the player shows a yellow banner and the DJ holds new suggestions until the next day (quota resets at midnight Pacific time). The <a href="/status">Status</a> page shows how many searches remain.</p>

<hr>

<h2 id="player">The player</h2>

<figure class="screenshot">
  <img class="zoomable" src="/guide/screenshots/full-player.png" alt="The full player — album art panel on the left, sidebar on the right">
  <figcaption>The full player — album art panel on the left, sidebar on the right</figcaption>
</figure>

<h3>Album art panel <em style="font-weight:400;color:#555;text-transform:none;letter-spacing:0">(Spotify mode)</em></h3>

<p>The left side shows the album art, which slowly pans across the image while a song plays.</p>
<ul>
  <li><strong>Click anywhere on the art</strong> to pause or resume playback.</li>
  <li><strong>▶ / ⏸ indicator</strong> — a small icon in the top-right corner tells you at a glance whether the song is playing or paused.</li>
  <li><strong>Hover</strong> over the art to see "play" or "pause" as text over a dim overlay.</li>
</ul>

<h3>YouTube video panel <em style="font-weight:400;color:#555;text-transform:none;letter-spacing:0">(YouTube mode)</em></h3>

<p>In YouTube mode the album art panel is replaced by an embedded YouTube video. The video autoplays when a song loads. Use the YouTube player controls (volume, fullscreen, etc.) directly within the embed.</p>
<ul>
  <li>The star rating and Next button work the same as in Spotify mode.</li>
  <li>Because playback is inside an iframe, the app's seek bar reflects elapsed time but does not control the YouTube player directly.</li>
</ul>

<figure class="screenshot">
  <img class="img-album-indicator" src="/guide/screenshots/album-indicator.png" alt="Album art with play indicator in top-right corner">
  <figcaption>Album art with ▶ indicator in top-right corner</figcaption>
</figure>

<h3>Track info</h3>

<p>At the bottom of the art panel:</p>
<ul>
  <li><strong>Song title</strong> — click it to open the track in Spotify or YouTube (depending on mode).</li>
  <li><strong>Artist</strong> and <strong>year</strong> — for contemporary recordings this is the release year; for classical music and jazz standards it shows the year of <em>composition</em> (e.g. "1785" for Mozart K. 475, not the CD release date).</li>
  <li><strong>DJ's reason</strong> — a one-sentence note explaining why this song was picked.</li>
</ul>

<h3>Progress bar</h3>

<p>Below the track info is a scrubber. Drag it to seek. If you drag it all the way to the end, the app advances to the next song — same as pressing Next.</p>

<h3>Stars and Next button</h3>

<p>Below the album panel you'll find the star rating (★ ½ to ★★★★★) and the <strong>Next</strong> button.</p>
<ul>
  <li>Rate the current song with 0.5–5 stars before pressing Next, or leave it unrated to skip.</li>
  <li>Pressing <strong>Next</strong> fades out the current track over ~700 ms and starts the next one.</li>
  <li>If a song plays to 98% of its duration, it auto-advances — counted as a full listen.</li>
</ul>

<hr>

<h2 id="rating">Rating a track</h2>

<p>Rating is how you teach the DJ your taste. Stars range from ½ to 5. Click the left half of a star for a half-star, the right half for a full star. Click a star again to clear it.</p>

<h3>In the Ratings page</h3>

<p>On the <strong>Ratings</strong> page, every song in your history shows its star rating. Click any star to revise the rating — the change is applied immediately to the session history the DJ uses.</p>

<hr>

<h2 id="reactions">How the DJ interprets ratings</h2>

<p>The DJ maps your star rating to inform the next batch of suggestions:</p>

<table>
  <thead>
    <tr><th>Stars</th><th>Meaning to the DJ</th></tr>
  </thead>
  <tbody>
    <tr><td>★★★★ – ★★★★★</td><td>Loved it. May return to this artist or nearby sound.</td></tr>
    <tr><td>★★ – ★★★½</td><td>Fine. Explore nearby territory.</td></tr>
    <tr><td>½ – ★½</td><td>Not for me. Steer away from this sound.</td></tr>
    <tr><td>(none / skipped)</td><td>Passed on without rating.</td></tr>
  </tbody>
</table>

<p>A low rating is about the sonic character of the track, not a ban on the artist. The same artist may have songs in very different styles — those remain fair game.</p>

<hr>

<h2 id="sidebar">The sidebar</h2>

<h3>Up next</h3>

<p>Shows the songs queued for playback. Click any song to jump to it immediately. Click <strong>×</strong> next to a song to remove it from the queue.</p>

<p>Below the confirmed queue, a <strong>"DJ is thinking…"</strong> section may appear showing song names and reasons the DJ has suggested but hasn't yet resolved to tracks. These become clickable once the lookup finishes.</p>

<h3>What I know about you</h3>

<p>The DJ maintains a short paragraph describing your taste — genres, eras, moods, energy levels. It updates after each rated song.</p>

<p>Click <strong>edit</strong> to manually revise the profile. Useful if it's wrong, or if you want to steer the DJ in a different direction.</p>

<hr>

<h2 id="channels">Channels</h2>

<p>Channels let you maintain separate listening sessions with completely independent histories, profiles, and settings. <strong>Make a channel for every mood</strong> — morning focus, late-night ambient, work, workout, a deep dive into Brazilian music — and switch between them without losing your place.</p>

<h3>What a channel stores</h3>
<ul>
  <li>Full listen history (Ratings)</li>
  <li>Session history sent to the DJ</li>
  <li>AI taste profile</li>
  <li>All settings: Discovery, Genres, Region, Time period, Popularity, Tell the DJ</li>
  <li>Where you left off on the current song (playback position)</li>
</ul>

<h3>Managing channels</h3>
<p>Use the <strong>Channels</strong> page (link in the header) to create, rename, and configure channels. Click <strong>+</strong> on the player page to go directly to a new channel.</p>

<hr>

<h2 id="taste-space">The taste space</h2>

<p>Soundings treats music as a <strong>high-dimensional space</strong> — not just genre tags. We know many things about songs: writers, performers, instruments, recording date, where it was recorded, and how it is categorized. <strong>All of those attributes can feed into a notion of distance</strong>: similar songs are <strong>close</strong>; different songs are farther apart.</p>

<p>If you like a song, the DJ can look for <strong>nearby</strong> music you haven't heard yet. If you dislike something, it can learn to <strong>avoid that general region</strong> of the space — not by banning one label, but by steering away from that neighborhood of sound.</p>

<hr>

<h2 id="map">The map</h2>

<figure class="screenshot">
  <img src="/guide/screenshots/music-map.svg" width="800" height="520" alt="Music map: green (liked), red (disliked), grey (not-now), genre labels">
  <figcaption>Music map — liked (green), disliked (red), skipped (grey); genre labels show rough regions</figcaption>
</figure>

<p>The <strong>Ratings</strong> page includes a <strong>Music Map</strong> — a simple 2D projection showing all the songs you've heard:</p>
<ul>
  <li><strong>X-axis:</strong> acoustic / live / traditional → electronic / synthesized</li>
  <li><strong>Y-axis:</strong> calm / sparse / minimal → intense / energetic / driving</li>
</ul>
<p>Each dot is a song. Colored labels mark broad genre regions. The map shows where your taste clusters and what territory you haven't explored yet.</p>

<hr>

<h2 id="status">Status and rate limiting</h2>

<p>Soundings calls a music service (Spotify or YouTube) and an AI service. Occasionally:</p>
<ul>
  <li><strong>Spotify rate limiting</strong> — a yellow banner appears with an estimated wait time.
    <ul>
      <li>Click <strong>Try now</strong> to ping Spotify immediately. If it responds, the ban clears and music resumes.</li>
      <li>Click <strong>Stats</strong> for a breakdown of API call counts.</li>
    </ul>
  </li>
  <li><strong>YouTube quota</strong> — roughly 100 song lookups per day on the free tier. When exhausted, the player pauses new suggestions until midnight Pacific time.</li>
  <li><strong>"Asking the DJ…" spinner</strong> — the AI is generating suggestions. Normal; takes a few seconds.</li>
  <li><strong>"LLM may be unavailable. Will retry."</strong> — the AI service returned an error. The app retries after 30 seconds.</li>
</ul>

<hr>

<h2 id="mobile">Mobile</h2>

<ul>
  <li><strong>Tap album art</strong> — play/pause</li>
  <li><strong>Drag progress bar to the end</strong> — advance to next song</li>
  <li><strong>Pinch to zoom</strong> — supported; useful in portrait mode to reveal the sidebar</li>
</ul>

<hr>

<h2 id="provider">LLM provider</h2>

<p>The <strong>Channels</strong> page lets you choose the AI model powering the DJ:</p>
<ul>
  <li><strong>DeepSeek</strong> (default) — fast and accurate</li>
  <li><strong>Claude</strong> (Anthropic) — strong musical reasoning</li>
  <li><strong>GPT-4o</strong> (OpenAI)</li>
  <li><strong>Gemini</strong> (Google)</li>
</ul>
<p>Switching providers mid-session is fine — the session history is passed to whichever model is active.</p>
`

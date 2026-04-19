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

<p>Soundings is a music discovery app that uses an AI DJ to learn your taste and surface music you haven't found yet. It works with Spotify (Premium) or YouTube (no account needed). Everything is stored in your browser — no server account required.</p>

<div class="quickstart">
  <div class="quickstart-label">Quick start</div>
  <p>All you need is the <strong>Next button</strong>. Press it when you hear something you don't like — the song gets no stars and the DJ steers away from that sound. If you like it, give it stars first. The more you rate, the more precisely the DJ learns your taste.</p>
  <p>Everything else is optional. Channels let you give explicit hints — genre, era, region — to focus the DJ faster.</p>
</div>

<div class="toc">
  <div class="toc-title">Contents</div>
  <ol>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#modes">Choosing a mode</a></li>
    <li><a href="#player">The player</a></li>
    <li><a href="#rating">Rating a track</a></li>
    <li><a href="#reactions">How the DJ interprets ratings</a></li>
    <li><a href="#queue">The queue</a></li>
    <li><a href="#channels">Channels</a></li>
    <li><a href="#map">The music map</a></li>
    <li><a href="#status">Status and rate limiting</a></li>
    <li><a href="#mobile">Mobile</a></li>
  </ol>
</div>

<hr>

<h2 id="how-it-works">How it works</h2>

<p>The AI DJ plots every song in a three-dimensional taste space — acoustic vs. electronic, calm vs. intense, obscure vs. mainstream. As you listen and rate, the DJ builds a picture of where you like to be in that space and picks songs accordingly. Songs you love pull future picks toward that neighborhood; songs you skip or rate low steer the DJ away.</p>

<hr>

<h2 id="modes">Choosing a mode</h2>

<table>
  <thead><tr><th>Mode</th><th>Requirement</th><th>Playback</th></tr></thead>
  <tbody>
    <tr><td><strong>Spotify</strong></td><td>Spotify Premium account</td><td>Full audio, seekable</td></tr>
    <tr><td><strong>YouTube</strong></td><td>No account needed</td><td>Embedded YouTube video</td></tr>
  </tbody>
</table>

<p>Both modes use the same AI DJ and channels system.</p>

<h3>YouTube quota</h3>
<p>The YouTube Data API allows roughly <strong>100 song lookups per day</strong> on the free tier. When the quota runs out, the player holds new suggestions until midnight Pacific time. The <a href="/status">Status</a> page shows how many searches remain.</p>

<hr>

<h2 id="player">The player</h2>

<figure class="screenshot">
  <img class="zoomable" src="/guide/screenshots/full-player.png" alt="The player showing album art, track info, stars, and Next button">
  <figcaption>The player — channel tabs at top, album art, track info, stars, and Next</figcaption>
</figure>

<h3>Channel tabs</h3>
<p>The row of pills at the top of the player shows your channels. Click any tab to switch immediately. The <strong>+</strong> button creates a new channel.</p>

<h3>Album art panel <em style="font-weight:400;color:#555;text-transform:none;letter-spacing:0">(Spotify mode)</em></h3>
<ul>
  <li><strong>Click</strong> the art to pause or resume.</li>
  <li>The <strong>▶ / ⏸</strong> icon in the top-right corner shows playback state at a glance.</li>
  <li>The art slowly pans while the song plays.</li>
</ul>

<h3>YouTube video panel <em style="font-weight:400;color:#555;text-transform:none;letter-spacing:0">(YouTube mode)</em></h3>
<p>The album art is replaced by an embedded YouTube video. Use the YouTube controls for volume and fullscreen. Stars and Next work the same as in Spotify mode.</p>

<h3>Track info</h3>
<ul>
  <li><strong>Song title</strong> — click it to open the track on Spotify or YouTube.</li>
  <li><strong>Artist</strong> and <strong>year</strong> — contemporary tracks show release year; classical music and jazz standards show the year of <em>composition</em>.</li>
  <li><strong>DJ's reason</strong> — one sentence explaining why this song was chosen.</li>
</ul>

<h3>Progress bar</h3>
<p>Drag to seek. Dragging all the way to the end advances to the next song, same as pressing Next.</p>

<h3>Stars and Next</h3>
<ul>
  <li>Rate with ½ to ★★★★★ before pressing Next, or leave unrated to skip.</li>
  <li><strong>Next</strong> fades out the current track and starts the next one.</li>
  <li><strong>Auto-advance when a track ends</strong> — when checked, the player moves on automatically at the end of a song. Uncheck it if you want to stay on a track as long as you like.</li>
</ul>

<hr>

<h2 id="rating">Rating a track</h2>

<p>Stars are how you teach the DJ. Click the left half of a star for a half-star, the right half for a full star. Click a lit star again to clear it.</p>

<p>You can revise ratings any time on the <strong>Channels</strong> page — changes take effect immediately.</p>

<hr>

<h2 id="reactions">How the DJ interprets ratings</h2>

<table>
  <thead>
    <tr><th>Stars</th><th>Meaning to the DJ</th></tr>
  </thead>
  <tbody>
    <tr><td>★★★★ – ★★★★★</td><td>Loved it — explore this neighborhood of the taste space.</td></tr>
    <tr><td>★★ – ★★★½</td><td>Fine — continue exploring nearby.</td></tr>
    <tr><td>½ – ★½</td><td>Not for me — steer away from this sound.</td></tr>
    <tr><td>(none / skipped)</td><td>Passed on without rating.</td></tr>
  </tbody>
</table>

<p>A low rating targets the <em>sound</em> of a track, not the artist. The same artist may have songs in very different styles — those stay fair game.</p>

<hr>

<h2 id="queue">The queue</h2>

<figure class="screenshot">
  <img class="zoomable" src="/guide/screenshots/up-next.png" alt="Queue showing one resolved track and two DJ suggestions pending">
  <figcaption>Queue — one resolved track ready to play, two DJ suggestions still being looked up</figcaption>
</figure>

<p>The sidebar shows what's coming up:</p>
<ul>
  <li><strong>Queue</strong> — tracks fully resolved and ready to play. Click any row to jump to it; click <strong>×</strong> to remove it.</li>
  <li><strong>DJ is thinking…</strong> — song names and reasons the DJ has proposed but hasn't finished looking up yet. They move into the queue once resolved.</li>
</ul>

<h3>What I know about you</h3>
<p>Below the queue the DJ shows a short profile of your taste — genres, eras, moods, energy levels — updated after each rated track. Click <strong>edit</strong> to revise it manually if it's wrong or if you want to steer the DJ in a new direction.</p>

<hr>

<h2 id="channels">Channels</h2>

<p>Channels let you maintain completely separate listening sessions — independent histories, profiles, and settings. Make a channel for every context: morning focus, late-night jazz, a workout playlist, a deep dive into Brazilian music. Switch between them from the player tabs without losing your place.</p>

<h3>Creating a channel</h3>
<p>Click <strong>+</strong> in the player tab row or go to the <strong>Channels</strong> page and click <strong>+</strong> in the sidebar. A new channel appears with no settings — the DJ explores broadly until you add constraints or it learns your taste.</p>

<figure class="screenshot">
  <img class="zoomable" src="/guide/screenshots/channel-settings.png" alt="Channel settings page showing genre chips, region, time period, artists, and popularity slider">
  <figcaption>Channel settings — pick genres, region, era, and artist anchors; the DJ follows them strictly</figcaption>
</figure>

<h3>Channel settings</h3>
<ul>
  <li><strong>Genres</strong> — toggle any combination of genre chips. The DJ stays within them.</li>
  <li><strong>Region</strong> — filter by geographic origin of the music.</li>
  <li><strong>Time period</strong> — decades (40s–Recent) or classical eras (Baroque, Romantic, etc.).</li>
  <li><strong>Artists</strong> — quick-pick anchors derived from your genre/era/region selections. Toggling an artist tells the DJ to include music from that artist or similar ones.</li>
  <li><strong>Popularity</strong> — slider from Obscure to Mainstream.</li>
  <li><strong>Notes and hints</strong> — free-text instructions to the DJ: extra artists, moods, things to avoid. Example: <em>"lean Coltrane, no smooth jazz, upbeat only"</em>.</li>
</ul>
<p><em>Changes take effect on the next song the DJ picks.</em></p>

<h3>What a channel stores</h3>
<ul>
  <li>Full listen history and star ratings</li>
  <li>Session history sent to the DJ</li>
  <li>AI taste profile</li>
  <li>All settings above</li>
  <li>Playback position on the current song</li>
</ul>

<h3>The All channel</h3>
<p>The <strong>All</strong> channel has no genre or region filters — the DJ explores freely across the entire taste space. It can't be deleted.</p>

<hr>

<h2 id="map">The music map</h2>

<figure class="screenshot">
  <img class="zoomable" src="/guide/screenshots/music-map.png" alt="Music map: green dots (liked), red dots (disliked), grey dots (skipped)">
  <figcaption>Music map — green: liked, red: disliked, grey: skipped; hover a dot for track details</figcaption>
</figure>

<p>Each channel has a <strong>Music Map</strong> at the bottom of its page, showing all the songs you've heard plotted in taste space:</p>
<ul>
  <li><strong>X-axis</strong> — acoustic / traditional → electronic / synthesized</li>
  <li><strong>Y-axis</strong> — calm / sparse → intense / energetic</li>
  <li><strong>Z-axis (depth)</strong> — obscure / underground → mainstream</li>
</ul>
<p>Green dots are liked songs, red are disliked, grey are skipped. Hover any dot to see the track and rating. The map shows where your taste clusters and what territory is still unexplored. Drag to rotate.</p>

<hr>

<h2 id="status">Status and rate limiting</h2>

<ul>
  <li><strong>Spotify rate limiting</strong> — a yellow banner appears with an estimated wait time. Click <strong>Try now</strong> to check if the ban has lifted; click <strong>Stats</strong> for API call counts.</li>
  <li><strong>YouTube quota</strong> — roughly 100 lookups per day. When exhausted, new suggestions pause until midnight Pacific.</li>
  <li><strong>"Asking the DJ…" spinner</strong> — the AI is generating suggestions. Normal; takes a few seconds.</li>
  <li><strong>"LLM may be unavailable. Will retry."</strong> — the AI returned an error; the app retries after 30 seconds.</li>
</ul>

<hr>

<h2 id="mobile">Mobile</h2>

<ul>
  <li><strong>Tap album art</strong> — play / pause</li>
  <li><strong>Drag progress bar to the end</strong> — skip to next song</li>
  <li>Turn off <strong>Auto-advance</strong> to keep a song playing without the screen staying active</li>
</ul>
`

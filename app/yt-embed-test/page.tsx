'use client'

import { useRef, useState } from 'react'
import YoutubePlayer from '@/app/player/YoutubePlayer'
import type { YoutubePlayerHandle } from '@/app/player/YoutubePlayer'

/**
 * YouTube embed tester — tests the real YoutubePlayer component (same code the app uses).
 * Visit /yt-embed-test to verify embeds without burning search quota.
 */

const DEFAULT_VIDEO_ID = 'jNQXAC9IVRw' // "Me at the zoo" — first YouTube video, always embeddable

function extractVideoId(input: string): string {
  const trimmed = input.trim()
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (watchMatch) return watchMatch[1]
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (shortMatch) return shortMatch[1]
  const embedMatch = trimmed.match(/embed\/([a-zA-Z0-9_-]{11})/)
  if (embedMatch) return embedMatch[1]
  return trimmed
}

export default function YtEmbedTestPage() {
  const [input, setInput] = useState(DEFAULT_VIDEO_ID)
  const [videoId, setVideoId] = useState(DEFAULT_VIDEO_ID)
  const playerRef = useRef<YoutubePlayerHandle>(null)

  function load() {
    setVideoId(extractVideoId(input))
  }

  return (
    <div style={{ padding: 32, background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: 16 }}>YouTube Embed Tester</h1>
      <p style={{ marginBottom: 12, color: '#555', fontSize: 12 }}>
        Uses the real <code style={{ color: '#888' }}>YoutubePlayer</code> component — same code as the app.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Video ID or youtube.com/watch?v=..."
          style={{ flex: 1, background: '#111', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 4, fontFamily: 'monospace' }}
        />
        <button
          onClick={load}
          style={{ background: '#333', border: '1px solid #555', color: '#fff', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}
        >
          Load
        </button>
      </div>

      <p style={{ marginBottom: 8, color: '#555', fontSize: 12 }}>
        video id: <span style={{ color: '#888' }}>{videoId}</span>
      </p>

      {/* Match the aspect ratio / container the app uses */}
      <div style={{ position: 'relative', width: 560, height: 315, background: '#111' }}>
        <YoutubePlayer ref={playerRef} videoId={videoId} />
      </div>

      <p style={{ marginTop: 12, color: '#444', fontSize: 11 }}>
        &ldquo;Video unavailable&rdquo; → the video blocks embedding (rights restriction), not an app bug.
      </p>
    </div>
  )
}

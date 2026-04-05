'use client'

import { useState } from 'react'

/**
 * YouTube embed tester — paste any video ID or URL to test embeds directly.
 * Visit /yt-embed-test to verify embed params without burning search quota.
 */

const DEFAULT_VIDEO_ID = 'jNQXAC9IVRw' // "Me at the zoo" — first YouTube video, always embeddable

function extractVideoId(input: string): string {
  const trimmed = input.trim()
  // Full URL: youtube.com/watch?v=ID or youtu.be/ID
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (watchMatch) return watchMatch[1]
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (shortMatch) return shortMatch[1]
  // embed URL
  const embedMatch = trimmed.match(/embed\/([a-zA-Z0-9_-]{11})/)
  if (embedMatch) return embedMatch[1]
  // Raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed
  return trimmed
}

const PRESETS = [
  { label: 'autoplay=1&mute=1', params: 'autoplay=1&mute=1' },
  { label: 'autoplay=1&mute=0', params: 'autoplay=1&mute=0' },
  { label: 'enablejsapi=1', params: 'enablejsapi=1&autoplay=1&mute=1' },
  { label: 'no params', params: '' },
]

export default function YtEmbedTestPage() {
  const [input, setInput] = useState(DEFAULT_VIDEO_ID)
  const [committed, setCommitted] = useState(DEFAULT_VIDEO_ID)
  const [params, setParams] = useState('autoplay=1&mute=1')
  const [customParams, setCustomParams] = useState('autoplay=1&mute=1')
  const [key, setKey] = useState(0) // force iframe remount

  const videoId = extractVideoId(committed)
  const embedSrc = params
    ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`
    : `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`

  function load() {
    setCommitted(input)
    setKey(k => k + 1)
  }

  function applyPreset(p: string) {
    setParams(p)
    setCustomParams(p)
    setKey(k => k + 1)
  }

  return (
    <div style={{ padding: 32, background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: 16 }}>YouTube Embed Tester</h1>

      {/* Video ID input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: '#888', display: 'block', marginBottom: 4 }}>Video ID or URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
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
      </div>

      {/* Query params */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: '#888', display: 'block', marginBottom: 4 }}>Query params</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.params)}
              style={{
                background: params === p.params ? '#444' : '#1a1a1a',
                border: `1px solid ${params === p.params ? '#888' : '#333'}`,
                color: params === p.params ? '#fff' : '#aaa',
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={customParams}
            onChange={e => setCustomParams(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (setParams(customParams), setKey(k => k + 1))}
            placeholder="e.g. autoplay=1&mute=1&start=30"
            style={{ flex: 1, background: '#111', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 4, fontFamily: 'monospace' }}
          />
          <button
            onClick={() => { setParams(customParams); setKey(k => k + 1) }}
            style={{ background: '#333', border: '1px solid #555', color: '#fff', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}
          >
            Apply
          </button>
        </div>
      </div>

      {/* Embed URL display */}
      <p style={{ marginBottom: 16, color: '#555', fontSize: 12, wordBreak: 'break-all' }}>
        <span style={{ color: '#444' }}>src: </span>
        <span style={{ color: '#888' }}>{embedSrc}</span>
      </p>

      {/* The iframe */}
      <iframe
        key={key}
        width="560"
        height="315"
        src={embedSrc}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        style={{ display: 'block', border: '1px solid #222' }}
      />

      <p style={{ marginTop: 12, color: '#444', fontSize: 11 }}>
        &ldquo;Video unavailable&rdquo; → the video blocks embedding (rights restriction), not an app bug.
        Try a different video ID.
      </p>
    </div>
  )
}

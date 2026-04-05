'use client'

/**
 * Minimal YouTube embed test — no JS API, no params, exactly the snippet YouTube gives you.
 * Visit /yt-embed-test to verify raw embeds work in this environment.
 */
export default function YtEmbedTestPage() {
  // A well-known, always-embeddable video (YouTube's own "YouTube" channel intro)
  const videoId = 'jNQXAC9IVRw' // "Me at the zoo" — first ever YouTube video, public domain

  return (
    <div style={{ padding: 32, background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: 8 }}>YouTube Embed Test</h1>
      <p style={{ marginBottom: 16, color: '#888' }}>
        Hard-coded video ID: <code style={{ color: '#fff' }}>{videoId}</code>
        <br />
        Embed URL: <code style={{ color: '#fff' }}>https://www.youtube.com/embed/{videoId}</code>
        <br />
        No extra query parameters — exactly what YouTube&apos;s &ldquo;Share → Embed&rdquo; gives you.
      </p>
      <iframe
        width="560"
        height="315"
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        style={{ display: 'block' }}
      />
      <p style={{ marginTop: 16, color: '#888' }}>
        If this shows &ldquo;Video unavailable&rdquo;, the issue is the browser/network environment,
        not the app&apos;s embed code.
      </p>
    </div>
  )
}

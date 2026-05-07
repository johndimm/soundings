'use client'

import { useEffect } from 'react'

const YT_PAUSE_MSG = JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' })

/** Pause/mute any active media while a static page (privacy, terms, etc.) is mounted. */
export default function AudioSilencer() {
  useEffect(() => {
    let ticks = 0
    const id = window.setInterval(() => {
      ticks += 1
      if (ticks > 24) { window.clearInterval(id); return }
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        try { el.muted = true; void el.pause() } catch { /* ignore */ }
      })
      document.querySelectorAll<HTMLIFrameElement>('iframe[src*="youtube.com/embed"]').forEach((f) => {
        try { f.contentWindow?.postMessage(YT_PAUSE_MSG, '*') } catch { /* ignore */ }
      })
    }, 350)
    return () => window.clearInterval(id)
  }, [])
  return null
}

'use client'
import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useState } from 'react'
import { extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'

// ── Minimal YT IFrame API types ──────────────────────────────────────────────
interface YTPlayer {
  getCurrentTime(): number
  getDuration(): number
  /** YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued */
  getPlayerState(): number
  pauseVideo(): void
  playVideo(): void
  setVolume(v: number): void
  destroy(): void
}
interface YTPlayerOptions {
  events?: {
    onReady?: (e: { target: YTPlayer }) => void
    onStateChange?: (e: { data: number }) => void
    onError?: (e: { data: number }) => void
  }
}
interface YTNamespace {
  Player: new (el: HTMLIFrameElement, opts?: YTPlayerOptions) => YTPlayer
  PlayerState: { ENDED: number }
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

// ── Singleton YT API loader ───────────────────────────────────────────────────
let ytApiReady = false
const ytQueue: (() => void)[] = []

function loadYtApi() {
  if (typeof window === 'undefined') return
  if (window.YT?.Player) { ytApiReady = true; return }
  const prev = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    prev?.()
    ytApiReady = true
    console.info('[yt] iframe API ready')
    ytQueue.forEach(cb => cb())
    ytQueue.length = 0
  }
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    console.info('[yt] injecting iframe_api script')
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  }
}

function whenYtReady(cb: () => void) {
  if (ytApiReady && window.YT?.Player) { cb(); return }
  ytQueue.push(cb)
  loadYtApi()
}

/**
 * Fallback when the YT.Player wrapper is not yet available: send a postMessage command
 * directly to the iframe. Requires `enablejsapi=1` in the embed URL (we set it).
 * Matches the undocumented-but-stable IFrame Player API protocol.
 *
 * Target origin is `'*'` — same as the upstream YT IFrame API itself — because Chrome
 * refuses to deliver messages targeted at `https://www.youtube.com` to a freshly
 * mounted iframe whose `contentWindow.location` is still `about:blank` (same-origin
 * with the parent document). The payload is an opaque command string with no sensitive
 * data, so wildcard origin is acceptable.
 */
function postCommand(iframe: HTMLIFrameElement | null, func: 'playVideo' | 'pauseVideo') {
  if (!iframe?.contentWindow) return false
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      '*',
    )
    return true
  } catch {
    return false
  }
}

/**
 * Call a method on the YT.Player wrapper when it is actually callable; otherwise
 * fall back to the iframe postMessage protocol. `new YT.Player(iframe, …)` returns
 * a bare stub in some cases — methods live on `event.target` inside onReady, so
 * the ref may be set even when `playVideo`/`pauseVideo` are not functions on it.
 */
function invoke(
  player: YTPlayer | null,
  iframe: HTMLIFrameElement | null,
  method: 'playVideo' | 'pauseVideo',
): 'player' | 'postmessage' | 'none' {
  if (player) {
    const fn = (player as unknown as Record<string, unknown>)[method]
    if (typeof fn === 'function') {
      try {
        ;(fn as () => void).call(player)
        return 'player'
      } catch {
        /* fall through to postMessage */
      }
    }
  }
  return postCommand(iframe, method) ? 'postmessage' : 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

/**
 * If the video hasn't started playing within this window, show the tap-to-play overlay.
 * Generous enough to cover: iframe load (~300–800ms on local dev), YT IFrame API handshake
 * (~200–500ms), autoplay-after-user-gesture grace, and Fast Refresh interruptions.
 */
const AUTOPLAY_TIMEOUT_MS = 3500

interface Props {
  videoId: string
  onEnded?: () => void
  onPlayerError?: (errorCode: number) => void
}

export type YoutubePlayerHandle = {
  fadeOut: () => Promise<void>
  getCurrentTime: () => number
  getDuration: () => number
  play: () => void
  pause: () => void
}

function buildEmbedSrc(videoId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  // playsinline: required for inline playback on iOS / many mobile WebViews (http://localhost too).
  return (
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` +
    `?autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`
  )
}

const YoutubePlayer = forwardRef<YoutubePlayerHandle, Props>(function YoutubePlayer(
  { videoId, onEnded, onPlayerError },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  /**
   * Latch for "user asked to play before the API wrapper was ready." Overlay click sets it;
   * onReady consumes it. Without this, the first tap on the tap-to-play overlay is a no-op
   * whenever the YT script is still loading.
   */
  const pendingPlayRef = useRef(false)
  const onEndedRef = useRef(onEnded)
  const onErrorRef = useRef(onPlayerError)
  onEndedRef.current = onEnded
  onErrorRef.current = onPlayerError

  const [blocked, setBlocked] = useState(false)

  const normalizedId = useMemo(() => extractYoutubeVideoIdLoose(videoId) ?? null, [videoId])
  const embedSrc = useMemo(() => (normalizedId ? buildEmbedSrc(normalizedId) : ''), [normalizedId])

  useEffect(() => {
    if (!normalizedId) return
    console.info('[yt] mount', { videoId, normalizedId })
    setBlocked(false)
    pendingPlayRef.current = false
    let destroyed = false

    /**
     * Poll getCurrentTime as a ground-truth fallback. The YT IFrame API handshake
     * (onReady/onStateChange) sometimes never completes — extension interference, origin
     * mismatch, unusually slow iframe handshake — even though the iframe's `autoplay=1`
     * successfully started playback. Without this poll, the tap-to-play overlay gets stuck
     * on top of a video that is actually playing (and audible), which looks exactly like
     * "nothing plays" from the user's perspective.
     */
    let lastPolledTime = 0
    const pollTimer = setInterval(() => {
      if (destroyed) return
      const p = ytPlayerRef.current
      if (!p) return
      let t = 0
      try {
        t = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0
      } catch {
        return
      }
      if (t > 0 && t !== lastPolledTime) {
        lastPolledTime = t
        setBlocked(prev => {
          if (prev) console.info('[yt] poll detected playback — clearing overlay', { t })
          return false
        })
      }
    }, 500)

    const autoplayTimer = setTimeout(() => {
      if (destroyed) return
      // Final check via the poll's metric: if time is already advancing we shouldn't show
      // the overlay at all.
      const p = ytPlayerRef.current
      let t = 0
      try { t = typeof p?.getCurrentTime === 'function' ? p.getCurrentTime() : 0 } catch {}
      if (t > 0) {
        console.info('[yt] autoplay timeout — but getCurrentTime > 0, suppressing overlay', { t })
        return
      }
      console.info('[yt] autoplay timeout — showing tap-to-play overlay', {
        hasPlayer: Boolean(ytPlayerRef.current),
      })
      setBlocked(true)
    }, AUTOPLAY_TIMEOUT_MS)

    whenYtReady(() => {
      if (destroyed || !iframeRef.current || !window.YT?.Player) {
        console.info('[yt] ready callback skipped', {
          destroyed,
          hasIframe: Boolean(iframeRef.current),
          hasYT: Boolean(window.YT?.Player),
        })
        return
      }
      const player = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: e => {
            // Stale callback from a previous (Strict-Mode-cleaned-up) effect: the effect's
            // `destroyed` flag is our only way to tell this wrapper should not win.
            if (destroyed) {
              console.info('[yt] onReady ignored — effect destroyed')
              return
            }
            // Canonical ref: `event.target` is the fully-initialized Player with methods
            // attached. The value returned from `new YT.Player(...)` is sometimes a bare stub
            // where `playVideo`/`pauseVideo` are missing.
            ytPlayerRef.current = e.target
            try {
              const s = e.target.getPlayerState()
              console.info('[yt] onReady', { state: s, pending: pendingPlayRef.current })
              // `autoplay=1` in the embed URL often has the video already playing/buffering
              // by the time the JS wrapper attaches. `onStateChange` only fires on *changes*,
              // so we'd never receive a state=1 event and the tap-to-play overlay would stay
              // up covering the video. Clear it here.
              if (s === 1 || s === 3) {
                clearTimeout(autoplayTimer)
                setBlocked(false)
              }
              if (pendingPlayRef.current || s === -1 || s === 2 || s === 5) {
                pendingPlayRef.current = false
                e.target.playVideo()
              }
            } catch (err) {
              console.warn('[yt] onReady play failed', err)
            }
          },
          onStateChange: e => {
            if (destroyed) return
            console.info('[yt] state', e.data)
            if (e.data === 1 || e.data === 3) {
              clearTimeout(autoplayTimer)
              setBlocked(false)
            }
            if (e.data === 0) onEndedRef.current?.()
          },
          onError: e => {
            if (destroyed) return
            console.warn('[yt] onError', e.data)
            onErrorRef.current?.(e.data)
          },
        },
      })
      // Tentative assignment so getCurrentTime / getDuration have something to poll; onReady
      // replaces it with the fully-initialized instance.
      ytPlayerRef.current = player
    })

    return () => {
      destroyed = true
      clearTimeout(autoplayTimer)
      clearInterval(pollTimer)
      // Intentionally NOT calling `ytPlayerRef.current?.destroy()` here:
      //
      // `YT.Player.destroy()` removes the <iframe> element from the DOM. In React Strict
      // Mode (dev) the cleanup fires between two effect invocations while the component is
      // still mounted — if we destroy the iframe now, the second effect invocation binds
      // a new `YT.Player` to an iframe that's been torn out from under React, and the YT
      // postMessage handshake silently fails (no onReady, no onStateChange, just a stuck
      // overlay — which is exactly the bug reported). When the component truly unmounts,
      // React removes the iframe itself, which stops playback. Memory for the wrapper's
      // internal listeners is reclaimed on page unload; that's an acceptable leak.
      ytPlayerRef.current = null
    }
  }, [normalizedId, videoId])

  useImperativeHandle(ref, () => ({
    fadeOut: async () => {},
    getCurrentTime: () => {
      try { return ytPlayerRef.current?.getCurrentTime() ?? 0 } catch { return 0 }
    },
    getDuration: () => {
      try { return ytPlayerRef.current?.getDuration() ?? 0 } catch { return 0 }
    },
    play: () => {
      const via = invoke(ytPlayerRef.current, iframeRef.current, 'playVideo')
      console.info('[yt] handle.play', { via, hasPlayer: Boolean(ytPlayerRef.current) })
      if (via !== 'player') pendingPlayRef.current = true
    },
    pause: () => {
      const via = invoke(ytPlayerRef.current, iframeRef.current, 'pauseVideo')
      console.info('[yt] handle.pause', { via, hasPlayer: Boolean(ytPlayerRef.current) })
    },
  }), [])

  if (!normalizedId) {
    return (
      <div className="absolute inset-0 z-[6] flex items-center justify-center bg-zinc-950 text-zinc-500 text-sm px-4 text-center">
        Invalid or missing YouTube video id
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-[6]">
      <iframe
        key={embedSrc}
        ref={iframeRef}
        title="YouTube video player"
        src={embedSrc}
        allow={IFRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
      {blocked && (
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center bg-black/70 cursor-pointer z-10"
          onClick={() => {
            const via = invoke(ytPlayerRef.current, iframeRef.current, 'playVideo')
            console.info('[yt] tap-to-play clicked', {
              via,
              hasPlayer: Boolean(ytPlayerRef.current),
              apiReady: ytApiReady,
            })
            if (via !== 'player') pendingPlayRef.current = true
            // Clear the overlay on user gesture. We used to wait for onStateChange
            // confirmation, but some environments never deliver that event (iframe API
            // handshake fails silently) even when playback is working — the overlay would
            // then stay stuck on top of a playing video. Skip-to-next / reload are the
            // recovery paths if play truly didn't start.
            setBlocked(false)
          }}
        >
          <span className="text-white text-6xl leading-none">▶</span>
        </button>
      )}
    </div>
  )
})

export default YoutubePlayer

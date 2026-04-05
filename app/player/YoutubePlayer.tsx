'use client'
import { useRef, useImperativeHandle, forwardRef, useMemo } from 'react'
import { extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'

const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

interface Props {
  videoId: string
  onEnded?: () => void
  onPlayerError?: (errorCode: number) => void
}

export type YoutubePlayerHandle = {
  fadeOut: () => Promise<void>
}

function buildEmbedSrc(videoId: string): string {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`
}

const YoutubePlayer = forwardRef<YoutubePlayerHandle, Props>(function YoutubePlayer(
  { videoId },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const normalizedId = useMemo(() => extractYoutubeVideoIdLoose(videoId) ?? null, [videoId])
  const embedSrc = useMemo(() => (normalizedId ? buildEmbedSrc(normalizedId) : ''), [normalizedId])

  useImperativeHandle(ref, () => ({ fadeOut: async () => {} }), [])

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
    </div>
  )
})

export default YoutubePlayer

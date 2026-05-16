import type { NextConfig } from 'next'

/** Ensures .env.local values are visible to server + client bundles after `next dev` / `next build`. */
const nextConfig: NextConfig = {
  transpilePackages: ['@johndimm/constellations'],
  env: {
    NEXT_PUBLIC_API_KEY: process.env.GEMINI_API_KEY ?? '',
    NEXT_PUBLIC_VITE_CACHE_URL: process.env.NEXT_PUBLIC_VITE_CACHE_URL ?? '',
    YOUTUBE_RESOLVE_TEST: process.env.YOUTUBE_RESOLVE_TEST ?? '',
    NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST: process.env.NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST ?? '',
    /** Server: opt-in extra videos.list after search (see app/lib/youtube.ts). */
    YOUTUBE_EMBED_CHECK: process.env.YOUTUBE_EMBED_CHECK ?? '',
    YOUTUBE_SKIP_VIDEOS_LIST: process.env.YOUTUBE_SKIP_VIDEOS_LIST ?? '',
  },
}

export default nextConfig

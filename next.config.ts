import type { NextConfig } from 'next'

/** Ensures .env.local values are visible to server + client bundles after `next dev` / `next build`. */
const nextConfig: NextConfig = {
  transpilePackages: ['@johndimm/constellations'],
  env: {
    NEXT_PUBLIC_API_KEY: process.env.GEMINI_API_KEY ?? '',
    VITE_API_KEY: process.env.GEMINI_API_KEY ?? '',
    VITE_AI_PROVIDER: (
      process.env.VITE_AI_PROVIDER ||
      process.env.NEXT_PUBLIC_VITE_AI_PROVIDER ||
      // When no cache proxy is configured the browser calls the LLM directly; use gemini
      // since GEMINI_API_KEY is present. When the proxy IS configured, leave this empty so
      // the proxy decides (deepseek, which has a key on Render.com).
      (process.env.NEXT_PUBLIC_VITE_CACHE_URL || process.env.VITE_CACHE_URL || process.env.VITE_CACHE_API_URL ? '' : 'gemini')
    ),
    NEXT_PUBLIC_VITE_CACHE_URL: (
      process.env.NEXT_PUBLIC_VITE_CACHE_URL ||
      process.env.VITE_CACHE_URL ||
      process.env.VITE_CACHE_API_URL ||
      ''
    ),
    YOUTUBE_RESOLVE_TEST: process.env.YOUTUBE_RESOLVE_TEST ?? '',
    NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST: process.env.NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST ?? '',
    /** Server: opt-in extra videos.list after search (see app/lib/youtube.ts). */
    YOUTUBE_EMBED_CHECK: process.env.YOUTUBE_EMBED_CHECK ?? '',
    YOUTUBE_SKIP_VIDEOS_LIST: process.env.YOUTUBE_SKIP_VIDEOS_LIST ?? '',
  },
}

export default nextConfig

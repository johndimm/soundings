export default function DocsIndex() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Home</a>
        <h1 className="text-3xl font-bold mt-6 mb-2">Docs</h1>
        <p className="text-zinc-400 text-sm mb-10">Technical documentation for Soundings.</p>

        <div className="flex flex-col gap-3">
          <a
            href="/docs/discovery"
            className="border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 transition-colors group"
          >
            <p className="font-medium text-zinc-100 group-hover:text-white">How Discovery Works</p>
            <p className="text-xs text-zinc-500 mt-1">
              How Soundings differs from Spotify's prompt-to-playlist: interaction model, tuning, and data control.
            </p>
          </a>
          <a
            href="/docs/spotify"
            className="border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 transition-colors group"
          >
            <p className="font-medium text-zinc-100 group-hover:text-white">How Soundings uses Spotify</p>
            <p className="text-xs text-zinc-500 mt-1">
              Every API call — search, playback, auth, rate limiting, OAuth scopes.
            </p>
          </a>
          <a
            href="/docs/youtube-response"
            className="border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 transition-colors group"
          >
            <p className="font-medium text-zinc-100 group-hover:text-white">YouTube API Services Compliance Review</p>
            <p className="text-xs text-zinc-500 mt-1">
              Point-by-point reply to the YouTube API Services violations report V.1.
            </p>
          </a>
          <a
            href="/privacy"
            className="border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 transition-colors group"
          >
            <p className="font-medium text-zinc-100 group-hover:text-white">Privacy Policy</p>
            <p className="text-xs text-zinc-500 mt-1">
              What data Soundings collects, how it's used, and your rights.
            </p>
          </a>
          <a
            href="/terms"
            className="border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 transition-colors group"
          >
            <p className="font-medium text-zinc-100 group-hover:text-white">Terms of Use</p>
            <p className="text-xs text-zinc-500 mt-1">
              Conditions for using Soundings, including YouTube and Spotify terms.
            </p>
          </a>
        </div>
      </div>
    </div>
  )
}

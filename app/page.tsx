import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBaseUrl } from '@/app/lib/baseUrl'
import RequestAccessForm from './RequestAccessForm'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const cookieStore = await cookies()
  const hasToken = cookieStore.has('spotify_access_token')
  const { error } = await searchParams
  const base = getBaseUrl()

  if (hasToken && !error) {
    redirect(base ? `${base}/player` : '/player')
  }

  const loginUrl = base ? `${base}/api/auth/login` : '/api/auth/login'
  const ytUrl = base ? `${base}/player?youtube=1` : '/player?youtube=1'
  const playerUrl = base ? `${base}/player` : '/player'

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
      <div className="flex flex-col items-center gap-10 max-w-lg w-full text-center px-6">

        {/* Title */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-5xl font-bold tracking-tight">Earprint</h1>
          <p className="text-zinc-400 text-lg">Music discovery that learns your taste</p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm -mb-4">
            {error === 'spotify_auth_failed'
              ? 'Spotify login was cancelled.'
              : error === 'token_exchange_failed'
                ? 'Could not complete Spotify login. Check redirect URI and credentials in the Spotify dashboard.'
                : 'Something went wrong. Please try again.'}
          </p>
        )}

        {hasToken ? (
          <a
            href={playerUrl}
            className="flex items-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold px-8 py-4 rounded-full transition-colors text-base"
          >
            Go to Player
          </a>
        ) : (
          <div className="grid grid-cols-2 gap-4 w-full">

            {/* Spotify option */}
            <a
              href={loginUrl}
              className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900 p-6 transition-colors group"
            >
              {/* Spotify logo */}
              <svg viewBox="0 0 24 24" className="w-12 h-12" fill="#1DB954">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <div className="flex flex-col items-center gap-1">
                <span className="font-semibold text-white text-base">Spotify</span>
                <span className="text-zinc-500 text-xs leading-snug">Requires Premium</span>
                <span className="text-zinc-600 text-xs leading-snug">Email must be on the allowed list</span>
              </div>
            </a>

            {/* YouTube option */}
            <a
              href={ytUrl}
              className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900 p-6 transition-colors group"
            >
              {/* YouTube logo */}
              <svg viewBox="0 0 24 24" className="w-12 h-12" fill="#FF0000">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <div className="flex flex-col items-center gap-1">
                <span className="font-semibold text-white text-base">YouTube</span>
                <span className="text-zinc-500 text-xs leading-snug">No account needed</span>
                <span className="text-zinc-600 text-xs leading-snug">Limited to ~100 searches/day</span>
              </div>
            </a>

          </div>
        )}

        {!hasToken && <RequestAccessForm />}

        {/* Footer links */}
        <div className="flex gap-4">
          <a href="/status" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Spotify status</a>
          <a href="/docs" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Docs</a>
          <a href="/diary.html" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Diary</a>
        </div>

      </div>
    </div>
  )
}

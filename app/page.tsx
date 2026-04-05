import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBaseUrl } from '@/app/lib/baseUrl'

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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
      <div className="flex flex-col items-center gap-8 max-w-sm text-center px-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-5xl font-bold tracking-tight">Earprint</h1>
          <p className="text-zinc-400 text-lg">Music discovery that learns your taste</p>
        </div>

        <p className="text-zinc-300 text-sm leading-relaxed">
          Listen to songs picked just for you. The longer you listen, the more
          we learn. Swipe to skip.
        </p>

        {error && (
          <p className="text-red-400 text-sm">
            {error === 'spotify_auth_failed'
              ? 'Spotify login was cancelled.'
              : error === 'token_exchange_failed'
                ? 'Could not complete Spotify login (token exchange). Check redirect URI and app credentials in the Spotify dashboard.'
                : 'Something went wrong. Please try again.'}
          </p>
        )}
        {hasToken ? (
          <a
            href={base ? `${base}/player` : '/player'}
            className="flex items-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold px-8 py-4 rounded-full transition-colors text-base"
          >
            Go to Player
          </a>
        ) : (
          <>
            <a
              href={loginUrl}
              className="flex items-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold px-8 py-4 rounded-full transition-colors text-base"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              Login with Spotify
            </a>
            <p className="text-zinc-500 text-xs">
              No Spotify Premium?{' '}
              <a
                href={base ? `${base}/player?youtube=1` : '/player?youtube=1'}
                className="text-zinc-300 hover:text-white underline transition-colors"
              >
                Try with YouTube
              </a>
            </p>
          </>
        )}

        <div className="flex gap-4">
          <a href="/status" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Spotify status</a>
          <a href="/docs" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Docs</a>
          <a href="/diary.html" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">Diary</a>
        </div>
      </div>
    </div>
  )
}

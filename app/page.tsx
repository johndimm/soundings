import { cookies } from 'next/headers'
import RequestAccessForm from './RequestAccessForm'

const FILM_DESC =
  'Picks a movie or TV trailer, shows it to you, and watches your reaction to guess your taste profile.'
const CONSTELLATIONS_DESC = 'Explore connections between people and events in Wikipedia.'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const cookieStore = await cookies()
  const hasSpotify = cookieStore.has('spotify_access_token')
  const { error } = await searchParams

  const loginUrl = '/api/auth/login'
  const ytUrl = '/api/auth/youtube'
  const playerUrl = '/player'

  const tvUrl = process.env.TRAILER_VISION_URL || 'http://localhost:3000'
  const consUrl = process.env.CONSTELLATIONS_URL || 'http://localhost:3001'

  const cardCls = 'flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8 shadow-sm'
  const titleCls = 'text-2xl sm:text-3xl font-bold tracking-tight text-white mt-5'
  const descCls = 'text-base sm:text-[1.05rem] leading-relaxed text-zinc-300 mt-3'

  return (
    <div className="min-h-dvh bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6 lg:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col">

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch lg:gap-8">

          {/* ── Soundings ── */}
          <section className={cardCls}>
            <div className="text-center">
              <span className="text-5xl leading-none">🎵</span>
              <h2 className={titleCls}>Soundings</h2>
              <p className={descCls}>
                Picks a song, plays it for you, and watches your reaction to learn the boundary between your likes and dislikes.
              </p>
            </div>

            {error && (
              <p className="mt-4 text-center text-sm text-red-400">
                {error === 'spotify_auth_failed'
                  ? 'Spotify login was cancelled.'
                  : error === 'token_exchange_failed'
                    ? 'Could not complete Spotify login.'
                    : 'Something went wrong. Please try again.'}
              </p>
            )}

            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
              <a
                href={hasSpotify ? playerUrl : loginUrl}
                className={`flex flex-col items-center gap-3 rounded-xl border px-4 py-5 text-center transition-colors ${
                  hasSpotify
                    ? 'border-emerald-500/55 bg-emerald-950/35 hover:border-emerald-400/80 hover:bg-emerald-950/50'
                    : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500 hover:bg-zinc-900'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-11 w-11 shrink-0" fill="#1DB954" aria-hidden>
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <div>
                  <span className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-base font-semibold text-white">Spotify</span>
                    {hasSpotify && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                        Signed in
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-sm text-zinc-300">
                    {hasSpotify ? 'Open Soundings' : 'Spotify Premium · Soundings beta access'}
                  </span>
                </div>
              </a>
              <a
                href={ytUrl}
                className="flex flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-5 text-center transition-colors hover:border-zinc-500 hover:bg-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-11 w-11 shrink-0" fill="#FF0000" aria-hidden>
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                <div>
                  <span className="block text-base font-semibold text-white">YouTube</span>
                  <span className="mt-1 block text-sm text-zinc-300">No login</span>
                </div>
              </a>
            </div>

            <div className="mt-8 border-t border-zinc-800 pt-8">
              <RequestAccessForm />
            </div>
          </section>

          {/* ── Trailer Vision ── */}
          <section className={cardCls}>
            <div className="flex flex-1 flex-col text-center">
              <span className="text-5xl leading-none">🎬</span>
              <h2 className={titleCls}>Trailer Vision</h2>
              <p className={descCls}>{FILM_DESC}</p>
              <a
                href={tvUrl}
                aria-label="Open Trailer Vision"
                className="group mt-5 block w-full shrink-0 overflow-hidden rounded-2xl shadow-sm outline-none ring-2 ring-transparent ring-offset-2 ring-offset-zinc-900 transition hover:opacity-95 hover:ring-sky-500/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/nano-banano-photo.png"
                  alt=""
                  className="block w-full rounded-2xl transition group-hover:scale-[1.01]"
                />
              </a>
              <div className="mt-8 flex min-h-[12rem] flex-1 flex-col gap-8 sm:min-h-0">
                <div className="flex flex-wrap justify-center gap-2">
                  {['Player', 'Channels', 'History', 'Watchlists'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-sky-500/20 px-3 py-1.5 text-sm font-medium text-sky-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex-1 sm:min-h-8" aria-hidden />
                <a
                  href={tvUrl}
                  className="inline-flex w-full max-w-[18rem] items-center justify-center self-center rounded-xl bg-sky-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-500"
                >
                  Open Trailer Vision
                </a>
              </div>
            </div>
          </section>

          {/* ── Constellations ── */}
          <section className={cardCls}>
            <div className="flex flex-1 flex-col text-center">
              <span className="text-5xl leading-none">🕸️</span>
              <h2 className={titleCls}>Constellations</h2>
              <p className={descCls}>{CONSTELLATIONS_DESC}</p>
              <a
                href={consUrl}
                aria-label="Open Constellations"
                className="group mt-5 block w-full shrink-0 overflow-hidden rounded-2xl shadow-sm outline-none ring-2 ring-transparent ring-offset-2 ring-offset-zinc-900 transition hover:opacity-95 hover:ring-violet-500/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/godfather.png"
                  alt=""
                  className="block w-full rounded-2xl transition group-hover:scale-[1.01]"
                />
              </a>
              <div className="mt-8 flex min-h-[12rem] flex-1 flex-col gap-8 sm:min-h-0">
                <div className="flex-1 sm:min-h-8" aria-hidden />
                <a
                  href={consUrl}
                  className="inline-flex w-full max-w-[18rem] items-center justify-center self-center rounded-xl bg-violet-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
                >
                  Open Constellations
                </a>
              </div>
            </div>
          </section>

        </div>

        <footer className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 border-t border-zinc-800/80 pt-8 text-sm text-zinc-500">
          <a href="https://github.com/johndimm/film-and-music" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-zinc-200">GitHub</a>
          <a href="https://www.linkedin.com/in/johndimm/" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-zinc-200">LinkedIn</a>
          <a href="/privacy" className="transition-colors hover:text-zinc-200">Privacy</a>
          <a href="/terms" className="transition-colors hover:text-zinc-200">Terms (coming soon)</a>
        </footer>

      </div>
    </div>
  )
}

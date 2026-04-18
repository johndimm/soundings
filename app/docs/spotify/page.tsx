export default function SpotifyDoc() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/docs" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Docs</a>

        <h1 className="text-3xl font-bold mt-6 mb-2">How Soundings uses Spotify</h1>
        <p className="text-zinc-400 mb-10 text-sm">
          Every Spotify API call the app makes — what it is, when it fires, and why it&apos;s needed.
        </p>

        {/* ── Auth ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">Authentication</h2>
          <div className="flex flex-col gap-6">

            <Call
              method="GET" endpoint="accounts.spotify.com/authorize"
              when="When the user clicks «Login with Spotify»"
              file="app/api/auth/login/route.ts"
            >
              Redirects the browser to Spotify&apos;s OAuth consent screen. Requests five scopes:{' '}
              <Code>streaming</Code>, <Code>user-read-email</Code>, <Code>user-read-private</Code>,{' '}
              <Code>user-modify-playback-state</Code>, <Code>user-read-playback-state</Code>.
              Not a rate-limited API call — it&apos;s a browser redirect.
            </Call>

            <Call
              method="POST" endpoint="accounts.spotify.com/api/token"
              when="Once, immediately after the user approves the OAuth consent"
              file="app/callback/route.ts"
            >
              Exchanges the one-time authorization code for an <strong>access token</strong> (valid 1 hour)
              and a <strong>refresh token</strong> (long-lived). Both are stored in HTTP-only cookies.
              This endpoint is on Spotify&apos;s accounts server, separate from the API rate limit.
            </Call>

            <Call
              method="POST" endpoint="accounts.spotify.com/api/token"
              when="Automatically, whenever the access token is within 1 minute of expiry"
              file="app/lib/spotify/tokens.ts"
            >
              Uses the refresh token to obtain a new access token without asking the user to log in again.
              Fires at most once per page load (checked on every <Code>/api/next-song</Code> request).
              Also on the accounts server — does not count toward the API rate limit.
            </Call>
          </div>
        </section>

        {/* ── User profile ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">User profile</h2>

          <Call
            method="GET" endpoint="api.spotify.com/v1/me"
            when="Once on player page load"
            file="app/api/spotify/me/route.ts · app/player/PlayerClient.tsx"
            rateImpact="1 call per session"
          >
            Fetches the logged-in user&apos;s display name and account type (free vs. Premium).
            Shown in the header. Premium is required for the Web Playback SDK — if the account
            is free, playback will fail and we surface that to the user.
          </Call>
        </section>

        {/* ── Song discovery ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">Song discovery</h2>
          <p className="text-zinc-400 text-sm mb-5">
            Triggered by the player when the queue is empty. The LLM recommends 3 songs by name;
            we then resolve them to actual Spotify tracks. Both calls below happen inside a single
            <Code>/api/next-song</Code> server request.
          </p>

          <div className="flex flex-col gap-6">
            <Call
              method="GET" endpoint="api.spotify.com/v1/tracks?ids=…"
              when="First attempt — only when the LLM returns valid Spotify IDs"
              file="app/lib/spotify.ts · getTracksByIds()"
              rateImpact="1 call for up to 3 tracks (batch)"
            >
              Batch-fetches up to 3 tracks in a single request using IDs the LLM embedded in its
              response. One API call regardless of how many songs are in the batch. If the IDs are
              wrong or missing this step is skipped and we fall through to text search.
              <br /><br />
              <span className="text-zinc-500 text-xs">
                Currently disabled (<Code>DEFAULT_FORCE_TEXT_SEARCH = true</Code>) because LLM-supplied
                IDs have historically been unreliable. Re-enabling this would cut search calls by ~3×.
              </span>
            </Call>

            <Call
              method="GET" endpoint="api.spotify.com/v1/search?q=…&type=track&limit=1"
              when="Fallback (or always, while force-text-search is enabled) — once per recommended song"
              file="app/lib/spotify.ts · searchTrack()"
              rateImpact="Up to 3 calls per queue refill · 250 ms delay between each"
            >
              Searches Spotify by the LLM&apos;s suggested track name + artist. Returns the top result.
              This is the <strong>highest-volume endpoint</strong> and the one that triggered past rate-limit bans.
              With the 250 ms inter-request delay, 3 searches take ~750 ms minimum.
              <br /><br />
              The queue refills roughly every 9 minutes of continuous listening (3 songs × ~3 min each),
              so under normal use this endpoint fires at most ~20 times per hour.
            </Call>
          </div>
        </section>

        {/* ── Playback ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">Playback control</h2>
          <div className="flex flex-col gap-6">

            <Call
              method="Script" endpoint="sdk.scdn.co/spotify-player.js"
              when="Once on player page load"
              file="app/player/PlayerClient.tsx"
              rateImpact="1 script load, not rate-limited"
            >
              Loads the Spotify Web Playback SDK. This registers the browser tab as a virtual
              Spotify device named «Soundings», visible in the Spotify app&apos;s device list.
              Requires a Premium account.
            </Call>

            <Call
              method="SDK" endpoint="player.getCurrentState()"
              when="Every 1 second while the player is active"
              file="app/player/PlayerClient.tsx · pollRef"
              rateImpact="No HTTP calls — local SDK method"
            >
              Reads playback position, duration, and pause state from the SDK&apos;s in-memory state.
              This is a <strong>local call only</strong> — it does not contact Spotify&apos;s servers and does
              not count toward the rate limit. Used to update the progress slider and detect
              when a song ends.
            </Call>

            <Call
              method="PUT" endpoint="api.spotify.com/v1/me/player/play?device_id=…"
              when="Each time a new track starts playing"
              file="app/player/PlayerClient.tsx · playTrack()"
              rateImpact="1 call per track change"
            >
              Tells Spotify to play a specific track URI on the Soundings device.
              Called directly from the browser with the access token.
              Fires when: a new card is loaded, the user taps a queue item, or replays a history item.
            </Call>

            <Call
              method="PUT" endpoint="api.spotify.com/v1/me/player/play?device_id=…"
              when="When the user taps a queue or history item"
              file="app/api/play-track/route.ts · playUri()"
              rateImpact="1 call per manual play"
            >
              Server-side wrapper for the same playback endpoint, used when the play request
              originates from a server action rather than a direct client fetch.
            </Call>

            <Call
              method="SDK" endpoint="player.resume() / player.pause()"
              when="When the user taps the album art to toggle playback"
              file="app/player/PlayerClient.tsx · togglePlayback()"
              rateImpact="No HTTP calls — local SDK method"
            >
              Resume or pause the local Spotify player. Local SDK calls, no server round-trip.
            </Call>
          </div>
        </section>

        {/* ── Rate limiting ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">Rate limiting</h2>
          <p className="text-zinc-400 text-sm mb-3">
            Spotify does not publish an official limit, but bans have occurred when too many{' '}
            <Code>/v1/search</Code> calls are made in a short window. Community reports suggest ~90 calls
            per 30 seconds as a rough ceiling.
          </p>
          <p className="text-zinc-400 text-sm mb-3">
            When Spotify returns a <Code>429</Code> response, the <Code>Retry-After</Code> header
            gives the wait time in seconds. The app stores this expiry in <Code>localStorage</Code>{' '}
            so it persists across page reloads and survives server cold-starts that would otherwise
            reset in-memory state.
          </p>
          <p className="text-zinc-400 text-sm">
            The <a href="/status" className="text-zinc-300 underline">call tracker</a> page shows
            a rolling chart of API requests and the peak 30-second window count so you can see
            whether normal use approaches the limit.
          </p>
        </section>

        {/* ── Scopes ── */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-zinc-100 border-b border-zinc-800 pb-2">OAuth scopes requested</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-zinc-500 text-xs uppercase">
                <th className="pb-2 pr-6">Scope</th>
                <th className="pb-2">Why it&apos;s needed</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {[
                ['streaming', 'Required for the Web Playback SDK to stream audio in the browser'],
                ['user-read-email', 'Required alongside user-read-private to authenticate the user'],
                ['user-read-private', 'Needed to read account type (Premium check) via /v1/me'],
                ['user-modify-playback-state', 'Required to issue play/pause commands via /v1/me/player/play'],
                ['user-read-playback-state', 'Required to read current playback state'],
              ].map(([scope, reason]) => (
                <tr key={scope} className="border-t border-zinc-800">
                  <td className="py-2 pr-6 font-mono text-xs text-zinc-400 whitespace-nowrap">{scope}</td>
                  <td className="py-2 text-zinc-400 text-xs">{reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </div>
    </div>
  )
}

function Call({
  method,
  endpoint,
  when,
  file,
  rateImpact,
  children,
}: {
  method: string
  endpoint: string
  when: string
  file: string
  rateImpact?: string
  children: React.ReactNode
}) {
  const methodColor: Record<string, string> = {
    GET: 'bg-blue-900 text-blue-200',
    POST: 'bg-green-900 text-green-200',
    PUT: 'bg-yellow-900 text-yellow-200',
    SDK: 'bg-purple-900 text-purple-200',
    Script: 'bg-zinc-700 text-zinc-200',
  }
  const color = methodColor[method] ?? 'bg-zinc-700 text-zinc-200'

  return (
    <div className="border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-2 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${color} flex-shrink-0`}>{method}</span>
        <code className="text-xs text-zinc-200 break-all">{endpoint}</code>
      </div>
      <p className="text-xs text-zinc-500 mb-1"><span className="text-zinc-400">When:</span> {when}</p>
      <p className="text-xs text-zinc-500 mb-1"><span className="text-zinc-400">File:</span> {file}</p>
      {rateImpact && (
        <p className="text-xs text-zinc-500 mb-2"><span className="text-zinc-400">Rate impact:</span> {rateImpact}</p>
      )}
      <p className="text-xs text-zinc-400 leading-relaxed mt-2">{children}</p>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-zinc-800 text-zinc-300 px-1 py-0.5 rounded text-xs">{children}</code>
}

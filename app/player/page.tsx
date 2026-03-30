import { cookies } from 'next/headers'
import PlayerClientWrapper from './PlayerClientWrapper'

export default async function PlayerPage() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('spotify_access_token')?.value

  if (!accessToken) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-xl font-semibold">No Spotify session detected.</p>
          <p className="text-sm text-zinc-400 mt-2">
            Log in via <a href="/api/auth/login" className="underline text-emerald-400">/api/auth/login</a>.
          </p>
        </div>
      </div>
    )
  }

  return <PlayerClientWrapper accessToken={accessToken!} />
}

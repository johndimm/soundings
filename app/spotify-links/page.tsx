import Link from 'next/link'

const STATUS_URL = 'https://earprint-six.vercel.app/api/spotify/status'
const LOGIN_URL = 'https://earprint-six.vercel.app/api/auth/login'
const LOGOUT_URL = 'https://earprint-six.vercel.app/api/auth/logout'

export default function SpotifyLinksPage() {
  return (
    <div className="min-h-screen bg-[#040404] text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] space-y-6">
        <h1 className="text-2xl font-semibold">Soundings Spotify Links</h1>
        <p className="text-sm text-zinc-400">
          Status endpoint:
          <br />
          <a href={STATUS_URL} className="text-emerald-400 underline" target="_blank" rel="noreferrer">
            {STATUS_URL}
          </a>
        </p>
        <div className="space-y-3">
          <Link href={LOGIN_URL} className="block text-center px-4 py-2 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-400 font-semibold">
            Log in with Spotify
          </Link>
          <Link href={LOGOUT_URL} className="block text-center px-4 py-2 rounded-full border border-zinc-700 text-zinc-100">
            Log out of Spotify
          </Link>
        </div>
        <p className="text-xs text-zinc-500">Use this page to reauthorize the deployed Soundings site on Vercel.</p>
      </div>
    </div>
  )
}

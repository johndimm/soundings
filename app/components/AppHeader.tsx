'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PAGE_LINKS = [
  { href: '/player', label: 'Player' },
  { href: '/channels', label: 'Channels' },
  { href: '/ratings', label: 'History' },
  { href: '/settings', label: 'Settings' },
]

const FILE_LINKS = [{ href: '/guide', label: 'Help' }]

export default function AppHeader() {
  const pathname = usePathname()
  const isPlayer = pathname.startsWith('/player')

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  return (
    <header className={`border-b ${isPlayer ? 'bg-black border-zinc-900' : 'bg-white border-zinc-200'}`}>
    <div className="flex items-center gap-2 px-4 py-2 max-w-[800px] mx-auto flex-wrap">
      <Link
        href="/player"
        className={`text-base font-bold transition-colors mr-1 ${isPlayer ? 'text-white hover:text-zinc-300' : 'text-black hover:text-zinc-600'}`}
      >
        Soundings
      </Link>

      <nav className="flex items-center gap-1 flex-1 flex-wrap">
        {PAGE_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-xs px-2.5 py-1 rounded transition-colors ${
              isActive(href)
                ? isPlayer ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-black'
                : isPlayer ? 'text-zinc-400 hover:text-white hover:bg-zinc-900' : 'text-zinc-500 hover:text-black hover:bg-zinc-100'
            }`}
          >
            {label}
          </Link>
        ))}

        <span className={`mx-1 ${isPlayer ? 'text-zinc-700' : 'text-zinc-300'}`}>·</span>

        {FILE_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-xs transition-colors px-1 ${
              isActive(href)
                ? isPlayer ? 'text-zinc-300' : 'text-zinc-700'
                : isPlayer ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <a
        href="/api/auth/logout"
        className={`text-xs transition-colors ${isPlayer ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-black'}`}
      >
        Logout
      </a>
    </div>
    </header>
  )
}

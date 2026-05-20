'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import FilmMusicHomeLink from '@/app/components/FilmMusicHomeLink'

const NAV_LINKS = [
  { href: '/player', label: 'Player' },
  { href: '/channels', label: 'Channels' },
  { href: '/ratings', label: 'History' },
  { href: '/settings', label: 'Settings' },
  { href: '/guide', label: 'Help' },
]

export default function AppHeader() {
  const pathname = usePathname()
  const isPlayer = pathname.startsWith('/player')

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  const linkClass = (href: string) => {
    const active = isActive(href)
    if (active) {
      return isPlayer ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-900'
    }
    return isPlayer
      ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
  }

  return (
    <header
      className={`sticky top-0 z-40 w-full min-w-0 shrink-0 border-b ${
        isPlayer ? 'border-zinc-800 bg-black/95' : 'border-zinc-200 bg-white/95'
      }`}
    >
      <div
        className={`mx-auto flex h-11 min-w-0 items-stretch px-3 sm:px-4 lg:px-8 ${
          isPlayer ? 'max-w-[min(100%,90rem)]' : 'max-w-[800px]'
        }`}
      >
        <div
          className={`sticky left-0 z-20 flex shrink-0 items-center gap-1.5 self-center border-r py-1 pr-2 sm:pr-3 ${
            isPlayer
              ? 'border-zinc-800 bg-black/95 shadow-[6px_0_12px_rgba(0,0,0,0.45)]'
              : 'border-zinc-200 bg-white/95 shadow-[6px_0_12px_rgba(0,0,0,0.06)]'
          }`}
        >
          <FilmMusicHomeLink variant={isPlayer ? 'playerDark' : 'surfaceLight'} />
          <span
            className={`hidden text-sm font-bold tracking-tight whitespace-nowrap sm:inline ${
              isPlayer ? 'text-zinc-100' : 'text-zinc-900'
            }`}
          >
            Soundings
          </span>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-h-11 items-center gap-1 pl-2 pr-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${linkClass(href)}`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div
          className={`sticky right-0 z-20 flex shrink-0 items-center self-center border-l py-1 pl-2 sm:pl-3 ${
            isPlayer
              ? 'border-zinc-800 bg-black/95 shadow-[-6px_0_12px_rgba(0,0,0,0.45)]'
              : 'border-zinc-200 bg-white/95 shadow-[-6px_0_12px_rgba(0,0,0,0.06)]'
          }`}
        >
          <a
            href="/api/auth/logout"
            className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 sm:text-sm ${
              isPlayer ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Logout
          </a>
        </div>
      </div>
    </header>
  )
}

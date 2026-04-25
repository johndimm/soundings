import { NextRequest } from 'next/server'

const MB = 'https://musicbrainz.org/ws/2'
// MusicBrainz requires a descriptive User-Agent
const UA = 'earprint/1.0 (https://github.com/johndimm/earprint)'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function mbGet(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${MB}/${path}${sep}fmt=json`, {
    headers: { 'User-Agent': UA },
    // Cache for 24h — personnel data is stable
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}: ${path}`)
  return res.json()
}

export interface Personnel {
  name: string
  instruments: string
}

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get('artist')?.trim()
  const release = req.nextUrl.searchParams.get('release')?.trim()

  if (!artist || !release) {
    return Response.json({ personnel: [] })
  }

  try {
    // Step 1: find the release MBID
    const query = `release:"${release}" AND artist:"${artist}"`
    const searchData = await mbGet(`release?query=${encodeURIComponent(query)}&limit=5`)
    const releases: Array<{ id: string; score?: number }> = searchData.releases ?? []
    if (!releases.length) return Response.json({ personnel: [] })

    const mbid = releases[0].id

    // Step 2: get release with recording list and album-level artist relations
    await sleep(1100)
    const releaseData = await mbGet(`release/${mbid}?inc=recordings+artist-rels`)

    const personnelMap = new Map<string, Set<string>>()
    const addCredit = (name: string, role: string) => {
      if (!name || !role) return
      const r = role.toLowerCase()
      if (['unknown', 'other', ''].includes(r)) return
      if (!personnelMap.has(name)) personnelMap.set(name, new Set())
      personnelMap.get(name)!.add(role)
    }

    // Album-level credits (producer, engineer, conductor, etc.)
    for (const rel of releaseData.relations ?? []) {
      const name: string = rel.artist?.name
      if (!name) continue
      const attrs: string[] = rel.attributes ?? []
      const role: string = attrs[0] ?? rel.type
      addCredit(name, role)
    }

    // Step 3: get performer credits from the first recording
    const firstRecordingId: string | undefined =
      releaseData.media?.[0]?.tracks?.[0]?.recording?.id
    if (firstRecordingId) {
      await sleep(1100)
      const recData = await mbGet(`recording/${firstRecordingId}?inc=artist-rels`)
      for (const rel of recData.relations ?? []) {
        const name: string = rel.artist?.name
        if (!name) continue
        const attrs: string[] = rel.attributes ?? []
        const role: string = attrs[0] ?? rel.type
        addCredit(name, role)
      }
    }

    const personnel: Personnel[] = Array.from(personnelMap.entries())
      .map(([name, roles]) => ({ name, instruments: Array.from(roles).join(' / ') }))
      .sort((a, b) => a.name.localeCompare(b.name))

    console.info(`[musicbrainz] ${artist} — ${release}: ${personnel.length} credits (mbid ${mbid})`)

    return Response.json({ personnel })
  } catch (e) {
    console.error('[musicbrainz] error', e)
    return Response.json({ personnel: [] })
  }
}

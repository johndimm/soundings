import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

const DATA_DIR = path.join(process.cwd(), 'data')
const SHARED_FACTORY_FILE = path.join(DATA_DIR, 'factory-channels.json')

type FactorySource = 'spotify' | 'youtube'

function sourceFile(src: FactorySource): string {
  return path.join(DATA_DIR, `factory-channels.${src}.json`)
}

function parseSource(value: string | null): FactorySource | null {
  return value === 'spotify' || value === 'youtube' ? value : null
}

async function readFactoryFile(file: string) {
  const raw = await fs.readFile(file, 'utf8')
  const parsed = JSON.parse(raw) as {
    savedAt?: string
    activeChannelId?: string
    channels?: unknown[]
  }
  if (!Array.isArray(parsed.channels) || parsed.channels.length === 0) {
    return { ok: false as const, reason: 'invalid_shape' as const }
  }
  return {
    ok: true as const,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    activeChannelId:
      typeof parsed.activeChannelId === 'string' && parsed.activeChannelId
        ? parsed.activeChannelId
        : undefined,
    channels: parsed.channels,
  }
}

/**
 * GET — public read of server-side factory channels (same shape as channel export).
 *
 * `?source=spotify|youtube` reads `data/factory-channels.<source>.json`; when that file is
 * missing it falls back to the shared `data/factory-channels.json` so old setups keep working.
 * Without `?source=`, only the shared file is consulted.
 *
 * POST — writes one of the factory files. `?source=spotify|youtube` (or body.source) targets
 * the per-source file, otherwise the shared file is written.
 *
 * POST auth: set `FACTORY_DEFAULTS_WRITE_SECRET` in env; client must send `writeToken` in the
 * JSON body matching it. In development, if the secret is unset, POST is allowed without `writeToken`.
 */
export async function GET(request: NextRequest) {
  const src = parseSource(request.nextUrl.searchParams.get('source'))
  const primary = src ? sourceFile(src) : SHARED_FACTORY_FILE
  try {
    const result = await readFactoryFile(primary)
    if (result.ok) {
      return NextResponse.json({ ...result, source: src, file: src ? `source:${src}` : 'shared' })
    }
    return NextResponse.json({ ok: false, reason: result.reason })
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : ''
    if (code !== 'ENOENT') {
      return NextResponse.json({ ok: false, reason: 'read_error' }, { status: 500 })
    }
    // Per-source file missing: fall back to shared file so existing installs still resolve.
    if (src) {
      try {
        const fallback = await readFactoryFile(SHARED_FACTORY_FILE)
        if (fallback.ok) {
          return NextResponse.json({ ...fallback, source: null, file: 'shared-fallback' })
        }
        return NextResponse.json({ ok: false, reason: fallback.reason })
      } catch (e2: unknown) {
        const code2 =
          e2 && typeof e2 === 'object' && 'code' in e2 ? (e2 as NodeJS.ErrnoException).code : ''
        if (code2 === 'ENOENT') return NextResponse.json({ ok: false, reason: 'missing_file' })
        return NextResponse.json({ ok: false, reason: 'read_error' }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: false, reason: 'missing_file' })
  }
}

export async function POST(request: NextRequest) {
  let body: {
    writeToken?: string
    channels?: unknown[]
    activeChannelId?: string | null
    source?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!Array.isArray(body.channels) || body.channels.length === 0) {
    return NextResponse.json({ ok: false, error: 'channels_required' }, { status: 400 })
  }

  const secret = process.env.FACTORY_DEFAULTS_WRITE_SECRET
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd) {
    if (!secret || body.writeToken !== secret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'unauthorized',
          hint: 'Set FACTORY_DEFAULTS_WRITE_SECRET on the server and send the same value as writeToken in the JSON body.',
        },
        { status: 401 },
      )
    }
  } else if (secret && body.writeToken !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const src =
    parseSource(request.nextUrl.searchParams.get('source')) ??
    parseSource(typeof body.source === 'string' ? body.source : null)
  const target = src ? sourceFile(src) : SHARED_FACTORY_FILE

  const payload = {
    savedAt: new Date().toISOString(),
    source: src,
    activeChannelId: typeof body.activeChannelId === 'string' ? body.activeChannelId : null,
    channels: body.channels,
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, savedAt: payload.savedAt, source: src })
}

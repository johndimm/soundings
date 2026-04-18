import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

const FACTORY_FILE = path.join(process.cwd(), 'data', 'factory-channels.json')

/**
 * GET — public read of server-side factory channels (same shape as channel export).
 * POST — write `data/factory-channels.json` (persistent on a normal Node host; not for read-only serverless disks).
 *
 * POST auth: set `FACTORY_DEFAULTS_WRITE_SECRET` in env; client must send `writeToken` in JSON body matching it.
 * In development, if the secret is unset, POST is allowed without `writeToken`.
 */
export async function GET() {
  try {
    const raw = await fs.readFile(FACTORY_FILE, 'utf8')
    const parsed = JSON.parse(raw) as {
      savedAt?: string
      activeChannelId?: string
      channels?: unknown[]
    }
    if (!Array.isArray(parsed.channels) || parsed.channels.length === 0) {
      return NextResponse.json({ ok: false, reason: 'invalid_shape' })
    }
    return NextResponse.json({
      ok: true,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      activeChannelId:
        typeof parsed.activeChannelId === 'string' && parsed.activeChannelId
          ? parsed.activeChannelId
          : undefined,
      channels: parsed.channels,
    })
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : ''
    if (code === 'ENOENT') {
      return NextResponse.json({ ok: false, reason: 'missing_file' })
    }
    return NextResponse.json({ ok: false, reason: 'read_error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let body: { writeToken?: string; channels?: unknown[]; activeChannelId?: string | null }
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

  const payload = {
    savedAt: new Date().toISOString(),
    activeChannelId: typeof body.activeChannelId === 'string' ? body.activeChannelId : null,
    channels: body.channels,
  }

  try {
    await fs.mkdir(path.dirname(FACTORY_FILE), { recursive: true })
    await fs.writeFile(FACTORY_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, savedAt: payload.savedAt })
}

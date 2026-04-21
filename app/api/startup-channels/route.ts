import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/startup-channels?source=spotify|youtube
 *
 * Returns the "startup" channel bundle used by the Load startup channels button
 * in the player when the user's only channel is the empty All row.
 *
 *   - source=youtube → data/factory-channels-youtube.json
 *   - source=spotify (or anything else) → data/factory-channels.json
 *
 * Response shape matches the channels export: { ok, channels, activeChannelId?, savedAt? }.
 */

const DATA_DIR = path.join(process.cwd(), 'data')
const YOUTUBE_FILE = path.join(DATA_DIR, 'factory-channels-youtube.json')
const SPOTIFY_FILE = path.join(DATA_DIR, 'factory-channels.json')

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('source')
  const source: 'spotify' | 'youtube' = raw === 'youtube' ? 'youtube' : 'spotify'
  const file = source === 'youtube' ? YOUTUBE_FILE : SPOTIFY_FILE
  const fileLabel = source === 'youtube' ? 'factory-channels-youtube.json' : 'factory-channels.json'

  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(text) as {
      savedAt?: string
      activeChannelId?: string
      channels?: unknown[]
    }
    if (!Array.isArray(parsed.channels) || parsed.channels.length === 0) {
      return NextResponse.json({ ok: false, reason: 'invalid_shape', source, file: fileLabel })
    }
    return NextResponse.json({
      ok: true,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      activeChannelId:
        typeof parsed.activeChannelId === 'string' && parsed.activeChannelId
          ? parsed.activeChannelId
          : undefined,
      channels: parsed.channels,
      source,
      file: fileLabel,
    })
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : ''
    if (code === 'ENOENT') {
      return NextResponse.json({ ok: false, reason: 'missing_file', source, file: fileLabel })
    }
    return NextResponse.json({ ok: false, reason: 'read_error', source, file: fileLabel }, { status: 500 })
  }
}

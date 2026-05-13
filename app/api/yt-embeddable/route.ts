import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ embeddable: false }, { status: 400 })
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`,
      { method: 'GET' }
    )
    return NextResponse.json({ embeddable: res.ok })
  } catch {
    return NextResponse.json({ embeddable: true })
  }
}

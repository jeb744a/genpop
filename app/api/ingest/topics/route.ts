import { NextResponse } from 'next/server'
import { runTopicBackfill } from '@/app/lib/topics/backfill'

/** ≤20 Gemini calls/run; well under Hobby ceiling. */
export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runTopicBackfill()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[topics ingest] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

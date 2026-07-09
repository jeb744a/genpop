import { NextResponse } from 'next/server'
import { runNewsIngest } from '@/app/lib/news/ingest'

/** Hobby fluid-compute ceiling is 300s; leave headroom via WALL_CLOCK_BUDGET_MS. */
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runNewsIngest()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[news ingest] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { runCourtsIngest } from '@/app/lib/courts/ingest'

/**
 * Free-tier CourtListener pacing is ~13s/request (5/min). Up to 20 pages needs
 * several minutes — use Hobby's full 300s ceiling.
 */
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
    const result = await runCourtsIngest()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[courts ingest] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { formatVerifyTable, verifyAllNewsFeeds } from '@/app/lib/newsFeeds/verify'

export const maxDuration = 60

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await verifyAllNewsFeeds()
  const format = new URL(request.url).searchParams.get('format')

  if (format === 'text') {
    return new NextResponse(formatVerifyTable(report), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return NextResponse.json(report)
}

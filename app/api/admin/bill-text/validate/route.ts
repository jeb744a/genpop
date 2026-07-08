import { NextResponse } from 'next/server'
import { createAdminClient } from '@/app/lib/supabase/admin'
import { validateBillTextForCard } from '@/app/lib/billText/acquire'
import type { CardDetail } from '@/app/lib/cards/types'

const HARNESS_SPACING_MS = 7_000

function harnessDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, HARNESS_SPACING_MS))
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const state = (searchParams.get('state') ?? 'AL').toUpperCase()
  const n = Math.min(Math.max(parseInt(searchParams.get('n') ?? '15', 10), 1), 50)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('source', 'legiscan')
    .eq('region', state)
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const cards = (data ?? []) as CardDetail[]
  const shuffled = cards.sort(() => Math.random() - 0.5).slice(0, n)

  const rows = []
  for (let i = 0; i < shuffled.length; i++) {
    if (i > 0) await harnessDelay()
    rows.push(await validateBillTextForCard(shuffled[i]))
  }

  return NextResponse.json({ state, count: rows.length, rows })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cardId } = await params

  let body: { slot?: string; reason?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slot, reason, note } = body
  if (!slot?.trim() || !reason?.trim()) {
    return NextResponse.json({ error: 'slot and reason are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { error } = await supabase.from('insight_flags').insert({
    card_id: cardId,
    user_id: user.id,
    slot: slot.trim(),
    reason: reason.trim(),
    note: note?.trim() || null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { getInsightForCard } from '@/app/lib/aiInsight/service'

export const maxDuration = 60

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await getInsightForCard(id)

  if (!result) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}

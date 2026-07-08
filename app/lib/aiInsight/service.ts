import type { CardDetail } from '@/app/lib/cards/types'
import { fetchCardById } from '@/app/lib/cards/queries'
import { generateInsight } from './generate'
import type { InsightApiResponse } from './types'

export async function getInsightForCard(cardId: string): Promise<InsightApiResponse | null> {
  const card = await fetchCardById(cardId)
  if (!card) return null

  if (card.card_type === 'live') {
    return { state: 'unavailable', message: 'AI Insight is not available for live news cards.' }
  }

  return getInsightForCardDetail(card)
}

export async function getInsightForCardDetail(card: CardDetail): Promise<InsightApiResponse> {
  const result = await generateInsight(card)

  if (!result.ok) {
    if (result.reason === 'pending') {
      return {
        state: 'pending',
        message: 'Summary is being prepared — check back shortly.',
        source_url: card.source_url,
      }
    }
    return {
      state: 'unavailable',
      message: 'Unable to generate insight at this time.',
      source_url: card.source_url,
    }
  }

  return {
    state: 'ready',
    content: result.content,
    source_url: card.source_url,
  }
}

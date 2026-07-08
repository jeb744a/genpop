import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { selectBillTextVersion } from '../app/lib/billText/select'
import { ensureBillText } from '../app/lib/billText/acquire'
import { classifyExtractedText } from '../app/lib/billText/quality'
import { generateInsight, getGeminiCallCount, resetGeminiCallCount } from '../app/lib/aiInsight/generate'
import type { CardDetail } from '../app/lib/cards/types'

for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const { data } = await sb
    .from('cards')
    .select('*')
    .eq('id', 'a88b9368-db74-4603-b691-eca16198cdf7')
    .single()
  const card = data as CardDetail

  console.log('=== 1. HB363 selection ===')
  const chosen = selectBillTextVersion(card.raw.texts)
  console.log('doc_id:', chosen?.doc_id, 'type:', chosen?.type)
  console.log('pass:', chosen?.doc_id === 3374103)

  console.log('\n=== 2. First acquisition ===')
  const first = await ensureBillText(card, chosen)
  console.log('status:', first.status, 'cache:', first.from_cache, 'fetches:', first.network_fetches)

  console.log('\n=== 3. Second acquisition (zero fetches) ===')
  const second = await ensureBillText(card, chosen)
  console.log('status:', second.status, 'cache:', second.from_cache, 'fetches:', second.network_fetches)
  console.log('pass:', second.from_cache && second.network_fetches === 0)

  console.log('\n=== 4. Quality gate ===')
  const garbled = 'xqzwp mnbvc kjhgf qwerty zxcvb plmokn '.repeat(20)
  console.log('garbled:', classifyExtractedText(garbled).status)

  console.log('\n=== 5. HB363 Insight ===')
  await sb.from('card_ai').delete().eq('card_id', card.id).eq('kind', 'insight')
  resetGeminiCallCount()
  const insight = await generateInsight(card)
  console.log('ok:', insight.ok, 'gemini:', getGeminiCallCount())
  if (insight.ok) {
    const s = insight.content.slots as Record<string, { value: string }>
    console.log('what_it_does:', s.what_it_does?.value?.slice(0, 160))
    console.log('meta.source_text:', insight.content.meta.source_text)
  }

  console.log('\n=== 6. low_quality → metadata-only, no Gemini ===')
  const garbledText = 'xqzwp mnbvc kjhgf qwerty zxcvb plmokn '.repeat(30)
  await sb.from('bill_texts').upsert({
    doc_id: 99999999,
    card_id: card.id,
    text_hash: 'test-garbled',
    type_id: 1,
    type: 'Test',
    version_date: '2026-01-01',
    state_link: 'https://example.com/test.pdf',
    extracted_text: garbledText,
    char_count: garbledText.length,
    page_count: 1,
    status: 'low_quality',
  })
  const savedTexts = card.raw.texts
  card.raw.texts = [
    {
      doc_id: 99999999,
      type: 'Test',
      type_id: 1,
      date: '2026-01-01',
      mime: 'application/pdf',
      text_size: 1000,
      text_hash: 'test-garbled',
      state_link: 'https://example.com/test.pdf',
    },
  ]
  await sb.from('card_ai').delete().eq('card_id', card.id)
  resetGeminiCallCount()
  const lowQInsight = await generateInsight(card)
  console.log('ok:', lowQInsight.ok, 'gemini:', getGeminiCallCount())
  if (lowQInsight.ok) {
    console.log('meta.source_text:', lowQInsight.content.meta.source_text)
    console.log(
      'what_it_does:',
      (lowQInsight.content.slots as Record<string, { value: string }>).what_it_does?.value
    )
  }
  card.raw.texts = savedTexts
  await sb.from('bill_texts').delete().eq('doc_id', 99999999)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

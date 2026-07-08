/**
 * Acceptance checks for AI Insight pipeline (SPEC_ai_insight.md).
 * Run: npx tsx scripts/test-insight.ts
 * Requires: .env.local with Supabase + GEMINI_API_KEY for full suite.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { acquireSourceText } from '../app/lib/aiInsight/acquireText'
import {
  generateInsight,
  getGeminiCallCount,
  resetGeminiCallCount,
} from '../app/lib/aiInsight/generate'
import type { CardDetail } from '../app/lib/cards/types'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

loadEnv()

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchCard(id: string): Promise<CardDetail | null> {
  const { data } = await sb.from('cards').select('*').eq('id', id).single()
  return data as CardDetail | null
}

async function findCard(filter: {
  source?: string
  external_id?: string
  status?: string
}): Promise<CardDetail | null> {
  let q = sb.from('cards').select('*').limit(1)
  if (filter.source) q = q.eq('source', filter.source)
  if (filter.external_id) q = q.eq('external_id', filter.external_id)
  if (filter.status) q = q.eq('status', filter.status)
  const { data } = await q.maybeSingle()
  return data as CardDetail | null
}

async function main() {
  const TEST_IDS = {
    fedreg: '519f6220-a866-4df5-88be-2b4cbd313a90',
    legiscan: 'a88b9368-db74-4603-b691-eca16198cdf7',
    pendingCourt: 'ba5231cd-94f3-42d0-8cd5-15a48fd138bb',
  }

  console.log('=== 1. Pending CourtListener docket ===')
  const pendingCard = await fetchCard(TEST_IDS.pendingCourt)
  if (!pendingCard) throw new Error('Pending court card not found')
  const pendingAcquired = await acquireSourceText(pendingCard)
  console.log('acquired:', pendingAcquired)
  resetGeminiCallCount()
  const pendingResult = await generateInsight(pendingCard)
  console.log('gemini calls:', getGeminiCallCount())
  if (!pendingResult.ok) throw new Error('Pending judicial should succeed')
  const slots = pendingResult.content.slots as Record<string, { value: string }>
  console.log('what_was_decided:', slots.what_was_decided?.value)
  console.log('holding:', slots.holding?.value)
  console.log('meta.source_text:', pendingResult.content.meta.source_text)

  console.log('\n=== 2. LegiScan metadata-only (HB363) ===')
  const legiscanCard = await fetchCard(TEST_IDS.legiscan)
  if (!legiscanCard) throw new Error('Legiscan card not found')
  const legAcquired = await acquireSourceText(legiscanCard)
  console.log('acquired:', legAcquired)
  if (process.env.GEMINI_API_KEY) {
    resetGeminiCallCount()
    const legResult = await generateInsight(legiscanCard)
    if (legResult.ok) {
      const ls = legResult.content.slots as Record<string, { value: string }>
      console.log('current_status:', ls.current_status?.value)
      console.log('what_it_does:', ls.what_it_does?.value)
      console.log('meta.source_text:', legResult.content.meta.source_text)
    } else {
      console.log('legiscan result:', legResult)
    }
  } else {
    console.log('SKIP — GEMINI_API_KEY not set')
  }

  console.log('\n=== 3. Cache hit (zero Gemini calls) ===')
  resetGeminiCallCount()
  const cacheResult = await generateInsight(pendingCard)
  console.log('fromCache:', cacheResult.ok ? cacheResult.fromCache : 'n/a')
  console.log('gemini calls:', getGeminiCallCount())
  if (!cacheResult.ok || !cacheResult.fromCache || getGeminiCallCount() !== 0) {
    throw new Error('Cache hit should perform zero Gemini calls')
  }

  console.log('\n=== 4. FedReg Buyer pardon ===')
  const fedregCard = await fetchCard(TEST_IDS.fedreg)
  if (!fedregCard) throw new Error('FedReg card not found')
  const fedAcquired = await acquireSourceText(fedregCard)
  console.log('acquired status:', fedAcquired.status, 'chars:', fedAcquired.text.length)
  if (process.env.GEMINI_API_KEY) {
    resetGeminiCallCount()
    const fedResult = await generateInsight(fedregCard)
    console.log('gemini calls:', getGeminiCallCount())
    if (fedResult.ok) {
      const fs = fedResult.content.slots as Record<string, { value: string; source_snippets?: unknown[] }>
      console.log('what_it_directs:', fs.what_it_directs?.value?.slice(0, 120))
      console.log('snippets:', fs.what_it_directs?.source_snippets?.length ?? 0)
      const { data: cached } = await sb
        .from('card_ai')
        .select('content')
        .eq('card_id', TEST_IDS.fedreg)
        .eq('kind', 'insight')
        .single()
      if (cached) {
        console.log('\nStored card_ai.content sample (truncated):')
        console.log(cached.content.slice(0, 800) + '...')
      }
    } else {
      console.log('fedreg result:', fedResult)
    }
  } else {
    console.log('SKIP — GEMINI_API_KEY not set')
  }

  console.log('\nAll runnable checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

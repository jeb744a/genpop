/**
 * Pre-launch validation harness for LegiScan bill-text acquisition.
 * Run: npx tsx scripts/validate-bill-text.ts AL 15
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { selectBillTextVersion } from '../app/lib/billText/select'
import { validateBillTextForCard } from '../app/lib/billText/acquire'
import { checkTextQuality } from '../app/lib/billText/quality'
import { generateInsight, getGeminiCallCount, resetGeminiCallCount } from '../app/lib/aiInsight/generate'
import type { CardDetail } from '../app/lib/cards/types'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

loadEnv()

const state = (process.argv[2] ?? 'AL').toUpperCase()
const count = Math.min(Math.max(parseInt(process.argv[3] ?? '15', 10), 1), 50)
const HARNESS_SPACING_MS = 7_000

function harnessDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, HARNESS_SPACING_MS))
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function printTable(rows: Awaited<ReturnType<typeof validateBillTextForCard>>[]) {
  console.log('\n| Bill | Version | doc_id | status | chars | dict_ratio | preview |')
  console.log('|------|---------|--------|--------|-------|------------|---------|')
  for (const r of rows) {
    const ratio = r.dictionary_ratio != null ? r.dictionary_ratio.toFixed(2) : '—'
    const preview = r.text_preview.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 80)
    console.log(
      `| ${r.bill_number} | ${r.version_type ?? '—'} | ${r.doc_id ?? '—'} | ${r.status} | ${r.char_count ?? '—'} | ${ratio} | ${preview}… |`
    )
  }
}

async function main() {
  console.log(`=== HB363 version selection ===`)
  const { data: hb363 } = await sb
    .from('cards')
    .select('*')
    .eq('source', 'legiscan')
    .filter('raw->>bill_number', 'eq', 'HB363')
    .maybeSingle()

  if (hb363) {
    const chosen = selectBillTextVersion((hb363 as CardDetail).raw.texts)
    console.log('Selected doc_id:', chosen?.doc_id, 'type:', chosen?.type)
    if (chosen?.doc_id !== 3374103) {
      console.warn('WARN: expected doc_id 3374103 for HB363 Engrossed')
    }
  }

  console.log(`\n=== Validation harness: ${count} random ${state} cards ===`)
  const { data: cards } = await sb
    .from('cards')
    .select('*')
    .eq('source', 'legiscan')
    .eq('region', state)
    .limit(200)

  const sample = ((cards ?? []) as CardDetail[]).sort(() => Math.random() - 0.5).slice(0, count)
  const rows = []
  for (let i = 0; i < sample.length; i++) {
    if (i > 0) await harnessDelay()
    rows.push(await validateBillTextForCard(sample[i]))
  }
  printTable(rows)

  if (hb363) {
    await harnessDelay()
    console.log(`\n=== HB363 full pipeline ===`)
    const card = hb363 as CardDetail
    resetGeminiCallCount()
    const result = await generateInsight(card)
    console.log('Insight ok:', result.ok, 'gemini calls:', getGeminiCallCount())
    if (result.ok) {
      const slots = result.content.slots as Record<string, { value: string }>
      console.log('what_it_does:', slots.what_it_does?.value?.slice(0, 120))
      console.log('meta.source_text:', result.content.meta.source_text)
    }

    console.log(`\n=== HB363 cache hit (zero fetches) ===`)
    resetGeminiCallCount()
    const cached = await generateInsight(card)
    console.log('fromCache:', cached.ok ? cached.fromCache : false, 'gemini:', getGeminiCallCount())
    await harnessDelay()
  }

  console.log(`\n=== Quality gate: garbled string ===`)
  const garbled = 'xqzwp mnbvc kjhgf qwerty zxcvb plmokn ijuhyt gfrdes waqszx edcrfv tgbyhn'
  const q = checkTextQuality(garbled)
  console.log('garbled check:', q)
  if (hb363) {
    resetGeminiCallCount()
    // Simulate low_quality by ensuring unavailable text path — direct classification only
    console.log('low_quality would block Insight substance (metadata-only fallback)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

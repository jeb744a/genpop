/**
 * Acceptance harness for news threshold pipeline.
 * Run: npx tsx scripts/test-news-acceptance.ts
 *
 * Covers: wire-collapse unit path, ingest run, idempotent re-run,
 * promoted card news_audit dump, near-miss / soak log from same run.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { runNewsIngest } from '../app/lib/news/ingest'
import { effectiveOutletId } from '../app/lib/news/wire'
import { JOB_PREFIX } from '../app/lib/newsThreshold'

function loadEnv() {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

loadEnv()

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function hourKey(): string {
  return `${JOB_PREFIX}${new Date().toISOString().slice(0, 13)}`
}

async function main() {
  console.log('=== Wire-collapse ===')
  const collapsed = effectiveOutletId(
    'washington-examiner',
    'Senate clears border package',
    'WASHINGTON (AP) — The Senate voted…',
    'The Associated Press'
  )
  console.log(JSON.stringify(collapsed, null, 2))
  if (collapsed.outlet_id !== 'ap' || collapsed.via_wire !== 'ap') {
    throw new Error('Wire-collapse failed')
  }
  console.log('PASS: republisher collapses to AP\n')

  // Clear this hour's job lock so we can run acceptance (dev only)
  const key = hourKey()
  await sb.from('job_log').delete().eq('job_key', key)

  console.log('=== Ingest run 1 ===')
  const run1 = await runNewsIngest()
  console.log(
    JSON.stringify(
      {
        skipped: run1.skipped,
        items_fetched: run1.items_fetched,
        items_new: run1.items_new,
        clusters_opened: run1.clusters_opened,
        clusters_joined: run1.clusters_joined,
        promotions: run1.promotions,
        promotions_deferred: run1.promotions_deferred,
        soak_pairs_logged: run1.soak_pairs_logged,
        near_misses: run1.near_misses,
        gemini_calls: run1.gemini_calls,
        feed_ok: run1.feed_status.filter((f) => !f.error && (f.http_status === 200 || f.http_status === 304))
          .length,
      },
      null,
      2
    )
  )

  console.log('\n=== Ingest run 2 (idempotent) ===')
  const run2 = await runNewsIngest()
  console.log(JSON.stringify({ skipped: run2.skipped, items_new: run2.items_new }, null, 2))
  if (!run2.skipped) {
    throw new Error('Expected second run in same hour to skip')
  }
  console.log('PASS: same-hour re-run is a no-op\n')

  console.log('=== Promoted cards (sample) ===')
  const { data: liveCards } = await sb
    .from('cards')
    .select('id, title, status, news_audit, external_id, last_action_at')
    .eq('source', 'news')
    .order('last_action_at', { ascending: false })
    .limit(5)

  if (!liveCards?.length) {
    console.log('No promotions yet this run (threshold may need more coverage).')
    console.log('Near-misses from run 1:', JSON.stringify(run1.near_misses, null, 2))
  } else {
    for (const c of liveCards.slice(0, 2)) {
      console.log('\n--- card', c.id, '---')
      console.log('title:', c.title)
      console.log('status:', c.status)
      console.log('external_id:', c.external_id)
      console.log('news_audit:', JSON.stringify(c.news_audit, null, 2))
    }
  }

  console.log('\n=== Soak pair log (recent, same window) ===')
  const { data: pairs } = await sb
    .from('news_cluster_pairs_log')
    .select('identity_a, identity_b, sim, joined, title_a, logged_at')
    .order('logged_at', { ascending: false })
    .limit(15)
  console.log(JSON.stringify(pairs, null, 2))

  console.log('\n=== Near-misses (job_log detail) ===')
  const { data: job } = await sb.from('job_log').select('detail').eq('job_key', key).maybeSingle()
  console.log(JSON.stringify((job?.detail as { near_misses?: unknown })?.near_misses ?? [], null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

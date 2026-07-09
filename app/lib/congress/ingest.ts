import { createAdminClient } from '@/app/lib/supabase/admin'
import { fetchBillPage, fetchBillDetail, fetchSummaries, fetchTextVersions, toCongressDate } from './api'
import { mapToCard, pickLatestSummary } from './transform'
import type { IngestResult } from './types'

const JOB_PREFIX = 'ingest:congress:'
const PAGE_SIZE = 250
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13) // "2026-06-15T18"
}

async function getWatermark(supabase: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await supabase
    .from('job_log')
    .select('detail')
    .like('job_key', `${JOB_PREFIX}%`)
    .eq('status', 'done')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const watermark = (data?.detail as Record<string, string> | null)?.watermark
  if (watermark) return watermark

  return new Date(Date.now() - SEVEN_DAYS_MS).toISOString()
}

export async function runCongressIngest(): Promise<IngestResult> {
  const supabase = createAdminClient()
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}`

  // Claim the job slot. Skip only if a *successful* run already exists this hour;
  // let failed/running rows be re-claimed so a retry always works.
  const { error: insertError } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: {} })

  if (insertError) {
    if (insertError.code === '23505') {
      // Row exists — check whether it completed successfully.
      const { data: existing } = await supabase
        .from('job_log')
        .select('status')
        .eq('job_key', jobKey)
        .single()
      if (existing?.status === 'done') return { skipped: true }
      // Previous run failed or stalled — re-claim it and retry.
      await supabase
        .from('job_log')
        .update({ status: 'running', detail: {}, ran_at: new Date().toISOString() })
        .eq('job_key', jobKey)
    } else {
      throw new Error(`Failed to claim job_log slot: ${insertError.message}`)
    }
  }

  const watermark = await getWatermark(supabase)
  const toDateTime = toCongressDate(new Date().toISOString())
  // 1-hour safety overlap to catch any clock skew on the API side.
  const fromDateTime = toCongressDate(
    new Date(Math.max(0, new Date(watermark).getTime() - 60 * 60 * 1000)).toISOString()
  )

  let written = 0
  let skippedBills = 0
  let maxUpdateDate = watermark
  let offset = 0
  let done = false

  try {
    while (!done) {
      const page = await fetchBillPage(fromDateTime, toDateTime, offset, PAGE_SIZE)
      const bills = page.bills ?? []

      if (bills.length === 0) break

      for (const item of bills) {
        // Bills are sorted updateDate desc; once we hit items older than the
        // overlap-adjusted watermark we can stop paging.
        if (item.updateDate < watermark) {
          done = true
          break
        }

        try {
          const [detailRes, summariesRes, textRes] = await Promise.all([
            fetchBillDetail(item.congress, item.type, item.number),
            fetchSummaries(item.congress, item.type, item.number),
            fetchTextVersions(item.congress, item.type, item.number),
          ])

          const bill = detailRes.bill
          // Attach text versions into the raw payload so they're available later.
          const raw = {
            ...bill,
            textVersions: textRes.textVersions ?? [],
          } as Record<string, unknown>

          const summary = pickLatestSummary(summariesRes.summaries ?? [])
          const card = mapToCard(bill, summary, raw)

          const { error: upsertError } = await supabase.from('cards').upsert(card, {
            onConflict: 'source,external_id',
            ignoreDuplicates: false,
          })

          if (upsertError) throw new Error(upsertError.message)

          written++
          if (item.updateDate > maxUpdateDate) maxUpdateDate = item.updateDate
        } catch (err) {
          console.warn(
            `[congress] skipped ${item.congress}-${item.type}-${item.number}:`,
            err instanceof Error ? err.message : err
          )
          skippedBills++
        }
      }

      if (bills.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    // Advance watermark only to the max updateDate of successfully written bills.
    await supabase
      .from('job_log')
      .update({
        status: 'done',
        detail: { watermark: maxUpdateDate, written, skippedBills },
      })
      .eq('job_key', jobKey)
  } catch (err) {
    await supabase
      .from('job_log')
      .update({ status: 'failed', detail: { error: String(err) } })
      .eq('job_key', jobKey)
    throw err
  }

  return { written, skippedBills, watermark: maxUpdateDate }
}

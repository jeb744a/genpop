import { createAdminClient } from '@/app/lib/supabase/admin'
import { fetchDocumentPage } from './api'
import { mapToCard } from './transform'
import type { FRIngestResult } from './types'

const JOB_PREFIX = 'ingest:fedreg:'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function dateMinusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function getWatermark(supabase: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await supabase
    .from('job_log')
    .select('detail')
    .like('job_key', `${JOB_PREFIX}%`)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const watermark = (data?.detail as Record<string, string> | null)?.watermark
  if (watermark) return watermark

  return new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10)
}

export async function runFedRegIngest(): Promise<FRIngestResult> {
  const supabase = createAdminClient()
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}`

  const { error: insertError } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: {} })

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('job_log')
        .select('status')
        .eq('job_key', jobKey)
        .single()
      if (existing?.status === 'done') return { skipped: true }
      await supabase
        .from('job_log')
        .update({ status: 'running', detail: {}, ran_at: new Date().toISOString() })
        .eq('job_key', jobKey)
    } else {
      throw new Error(`Failed to claim job_log slot: ${insertError.message}`)
    }
  }

  const watermark = await getWatermark(supabase)
  // 1-day overlap so documents published late in the day aren't missed.
  const fromDate = dateMinusDays(watermark, 1)

  let written = 0
  let skippedDocs = 0
  let maxPublicationDate = watermark
  let page = 1
  let done = false

  try {
    while (!done) {
      const data = await fetchDocumentPage(fromDate, page)
      const docs = data.results ?? []

      if (docs.length === 0) break

      for (const doc of docs) {
        // Results are ordered newest first; stop when we hit docs older than watermark.
        if (doc.publication_date < watermark) {
          done = true
          break
        }

        try {
          const card = mapToCard(doc)

          const { error: upsertError } = await supabase.from('cards').upsert(card, {
            onConflict: 'source,external_id',
            ignoreDuplicates: false,
          })

          if (upsertError) throw new Error(upsertError.message)

          written++
          if (doc.publication_date > maxPublicationDate) {
            maxPublicationDate = doc.publication_date
          }
        } catch (err) {
          console.warn(
            `[fedreg] skipped ${doc.document_number}:`,
            err instanceof Error ? err.message : err
          )
          skippedDocs++
        }
      }

      if (page >= data.total_pages) break
      page++
    }

    await supabase
      .from('job_log')
      .update({
        status: 'done',
        detail: { watermark: maxPublicationDate, written, skippedDocs },
      })
      .eq('job_key', jobKey)
  } catch (err) {
    await supabase
      .from('job_log')
      .update({ status: 'failed', detail: { error: String(err) } })
      .eq('job_key', jobKey)
    throw err
  }

  return { written, skippedDocs, watermark: maxPublicationDate }
}

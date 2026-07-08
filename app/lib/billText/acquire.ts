import { extractText, getDocumentProxy } from 'unpdf'
import { createAdminClient } from '@/app/lib/supabase/admin'
import type { CardDetail } from '@/app/lib/cards/types'
import { getBillText } from '@/app/lib/legiscan/api'
import { classifyExtractedText } from './quality'
import { selectBillTextVersion } from './select'
import { withHostThrottle } from './throttle'
import type {
  AcquireResult,
  BillTextRow,
  BillTextStatus,
  BillTextVersion,
  QualityMetrics,
  ValidationRow,
} from './types'
import { NON_RETRYABLE_STATUSES } from './types'

export { selectBillTextVersion } from './select'
export { checkTextQuality, classifyExtractedText, QUALITY_THRESHOLDS } from './quality'

const MAX_PDF_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const PARSE_TIMEOUT_MS = 20_000
const MAX_FETCH_ATTEMPTS = 2
const INSIGHT_TEXT_SLICE = 24_000

function userAgent(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://genpop.us'
  return `GenPopBot/1.0 (+${site}; civic data; contact@genpop.us)`
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF'
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; page_count: number } | null> {
  const work = async () => {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text, totalPages } = await extractText(pdf, { mergePages: true })
    return { text: text.trim(), page_count: totalPages }
  }

  try {
    return await Promise.race([
      work(),
      delay(PARSE_TIMEOUT_MS).then(() => {
        throw new Error('parse timeout')
      }),
    ])
  } catch {
    return null
  }
}

async function streamPdfFromResponse(res: Response): Promise<Buffer | 'too_large' | 'not_pdf' | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_PDF_BYTES) return 'too_large'
    chunks.push(value)
  }

  const buffer = Buffer.concat(chunks)
  const contentType = res.headers.get('content-type') ?? ''
  const looksLikePdf =
    contentType.includes('pdf') ||
    contentType.includes('octet-stream') ||
    isPdfBuffer(buffer)

  if (!looksLikePdf || !isPdfBuffer(buffer)) return 'not_pdf'
  return buffer
}

async function fetchPdfFromUrl(url: string): Promise<Buffer | BillTextStatus> {
  return withHostThrottle(url, async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent() },
        signal: controller.signal,
      })

      if (!res.ok) return 'fetch_failed'

      const result = await streamPdfFromResponse(res)
      if (result === 'too_large') return 'too_large'
      if (result === 'not_pdf' || result === null) return 'fetch_failed'
      return result
    } catch {
      return 'fetch_failed'
    } finally {
      clearTimeout(timer)
    }
  })
}

async function fetchPdfFromLegiscan(docId: number): Promise<Buffer | BillTextStatus> {
  try {
    const response = await getBillText(docId)
    const doc = response.text?.doc
    if (!doc) return 'fetch_failed'
    const buffer = Buffer.from(doc, 'base64')
    if (buffer.length > MAX_PDF_BYTES) return 'too_large'
    if (!isPdfBuffer(buffer)) return 'fetch_failed'
    return buffer
  } catch (err) {
    console.warn('[billText] LegiScan getBillText fallback failed for doc_id', docId, err)
    return 'fetch_failed'
  }
}

async function readStoredRow(docId: number): Promise<BillTextRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('bill_texts').select('*').eq('doc_id', docId).maybeSingle()
  return data as BillTextRow | null
}

async function upsertRow(row: {
  doc_id: number
  card_id: string
  text_hash: string
  type_id: number
  type: string
  version_date: string | null
  state_link: string
  extracted_text: string | null
  char_count: number | null
  page_count: number | null
  status: BillTextStatus
}): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('bill_texts').upsert(
    {
      ...row,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'doc_id' }
  )
}

function toQualityMetrics(quality: ReturnType<typeof classifyExtractedText>['quality']): QualityMetrics {
  return {
    char_count: quality.char_count,
    dictionary_ratio: quality.dictionary_ratio,
    avg_token_length: quality.avg_token_length,
    has_legislative_marker: quality.has_legislative_marker,
    failure_reason: quality.failure_reason,
  }
}

function cachedResult(row: BillTextRow, version: BillTextVersion): AcquireResult {
  return {
    status: row.status,
    text: row.status === 'ok' ? row.extracted_text : null,
    doc_id: row.doc_id,
    version,
    from_cache: true,
    network_fetches: 0,
    quality:
      row.char_count != null
        ? {
            char_count: row.char_count,
            dictionary_ratio: null,
            avg_token_length: null,
            has_legislative_marker: row.status === 'ok',
          }
        : undefined,
  }
}

async function downloadAndParse(
  version: BillTextVersion,
  networkCounter: { count: number }
): Promise<{
  status: BillTextStatus
  text: string | null
  char_count: number | null
  page_count: number | null
  quality?: QualityMetrics
}> {
  let pdf: Buffer | BillTextStatus = await fetchPdfFromUrl(version.state_link)
  networkCounter.count += 1

  if (pdf === 'fetch_failed' || pdf === 'too_large') {
    if (pdf === 'too_large') return { status: 'too_large', text: null, char_count: null, page_count: null }

    console.info(
      '[billText] state_link failed for doc_id',
      version.doc_id,
      '— falling back to LegiScan getBillText (uses API quota)'
    )
    pdf = await fetchPdfFromLegiscan(version.doc_id)
    networkCounter.count += 1
  }

  if (typeof pdf === 'string') {
    return { status: pdf, text: null, char_count: null, page_count: null }
  }

  const parsed = await parsePdfBuffer(pdf)
  if (!parsed) {
    return { status: 'parse_failed', text: null, char_count: null, page_count: null }
  }

  const classified = classifyExtractedText(parsed.text)
  const quality = toQualityMetrics(classified.quality)

  if (classified.status === 'image_only') {
    return {
      status: 'image_only',
      text: null,
      char_count: quality.char_count,
      page_count: parsed.page_count,
      quality,
    }
  }

  if (classified.status === 'low_quality') {
    return {
      status: 'low_quality',
      text: parsed.text,
      char_count: quality.char_count,
      page_count: parsed.page_count,
      quality,
    }
  }

  return {
    status: 'ok',
    text: parsed.text,
    char_count: quality.char_count,
    page_count: parsed.page_count,
    quality,
  }
}

/**
 * Lazily acquire bill text for a legiscan card (SPEC §3–§5).
 * Called on Insight cache miss; caches in bill_texts.
 */
export async function ensureBillText(
  card: CardDetail,
  version?: BillTextVersion | null
): Promise<AcquireResult> {
  const chosen = version ?? selectBillTextVersion(card.raw.texts)

  if (!chosen) {
    return {
      status: 'no_text_version',
      text: null,
      doc_id: null,
      version: null,
      from_cache: false,
      network_fetches: 0,
    }
  }

  if (chosen.text_size > MAX_PDF_BYTES) {
    await upsertRow({
      doc_id: chosen.doc_id,
      card_id: card.id,
      text_hash: chosen.text_hash,
      type_id: chosen.type_id,
      type: chosen.type,
      version_date: chosen.date,
      state_link: chosen.state_link,
      extracted_text: null,
      char_count: null,
      page_count: null,
      status: 'too_large',
    })
    return {
      status: 'too_large',
      text: null,
      doc_id: chosen.doc_id,
      version: chosen,
      from_cache: false,
      network_fetches: 0,
    }
  }

  const existing = await readStoredRow(chosen.doc_id)
  if (existing && existing.text_hash === chosen.text_hash) {
    if (existing.status === 'ok') {
      return cachedResult(existing, chosen)
    }
    if (NON_RETRYABLE_STATUSES.has(existing.status)) {
      return cachedResult(existing, chosen)
    }
  }

  const networkCounter = { count: 0 }
  let lastStatus: BillTextStatus = 'fetch_failed'
  let lastPayload: Awaited<ReturnType<typeof downloadAndParse>> | null = null

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(1_000 * attempt)
    const result = await downloadAndParse(chosen, networkCounter)
    lastPayload = result
    lastStatus = result.status

    if (result.status === 'ok' || NON_RETRYABLE_STATUSES.has(result.status)) {
      break
    }
  }

  const final = lastPayload ?? {
    status: lastStatus,
    text: null,
    char_count: null,
    page_count: null,
  }

  await upsertRow({
    doc_id: chosen.doc_id,
    card_id: card.id,
    text_hash: chosen.text_hash,
    type_id: chosen.type_id,
    type: chosen.type,
    version_date: chosen.date,
    state_link: chosen.state_link,
    extracted_text: final.status === 'ok' ? final.text : final.status === 'low_quality' ? final.text : null,
    char_count: final.char_count,
    page_count: final.page_count,
    status: final.status,
  })

  return {
    status: final.status,
    text: final.status === 'ok' ? final.text : null,
    doc_id: chosen.doc_id,
    version: chosen,
    from_cache: false,
    network_fetches: networkCounter.count,
    quality: final.quality,
  }
}

/** Read cached ok text for Insight; does not fetch. */
export async function readBillTextForInsight(
  card: CardDetail,
  version?: BillTextVersion | null
): Promise<string | null> {
  const chosen = version ?? selectBillTextVersion(card.raw.texts)
  if (!chosen) return null

  const row = await readStoredRow(chosen.doc_id)
  if (!row || row.text_hash !== chosen.text_hash || row.status !== 'ok' || !row.extracted_text) {
    return null
  }

  return trimBillTextForInsight(row.extracted_text)
}

export function trimBillTextForInsight(text: string): string {
  if (text.length <= INSIGHT_TEXT_SLICE) return text
  return `${text.slice(0, INSIGHT_TEXT_SLICE)}\n\n[Text truncated for analysis — full document at source URL]`
}

/** Validation harness helper: selection + acquisition for one card. */
export async function validateBillTextForCard(card: CardDetail): Promise<ValidationRow> {
  const version = selectBillTextVersion(card.raw.texts)
  const billNumber =
    typeof card.raw.bill_number === 'string' ? card.raw.bill_number : card.external_id

  if (!version) {
    return {
      card_id: card.id,
      bill_number: billNumber,
      doc_id: null,
      version_type: null,
      status: 'no_text_version',
      char_count: null,
      dictionary_ratio: null,
      text_preview: '',
    }
  }

  const result = await ensureBillText(card, version)
  const previewSource =
    result.text ??
    (result.status === 'low_quality'
      ? (await readStoredRow(version.doc_id))?.extracted_text ?? ''
      : '')

  return {
    card_id: card.id,
    bill_number: billNumber,
    doc_id: version.doc_id,
    version_type: version.type,
    status: result.status,
    char_count: result.quality?.char_count ?? null,
    dictionary_ratio: result.quality?.dictionary_ratio ?? null,
    text_preview: previewSource.slice(0, 300),
  }
}

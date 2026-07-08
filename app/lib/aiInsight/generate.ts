import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/app/lib/supabase/admin'
import type { CardDetail } from '@/app/lib/cards/types'
import { ensureBillText } from '@/app/lib/billText/acquire'
import { selectBillTextVersion } from '@/app/lib/billText/select'
import type { BillTextStatus, BillTextVersion } from '@/app/lib/billText/types'
import { acquireSourceText } from './acquireText'
import { computeInputHash } from './inputHash'
import {
  MODEL_NAME,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  responseSchemaForCard,
} from './prompt'
import type { AcquiredText, InsightContent } from './types'
import { buildMetadataOnlyLegislativeInsight, buildPendingJudicialInsight, validateInsightContent } from './validate'

const DAILY_INSIGHT_CAP = 150
const BUDGET_FEATURE = 'insight'
const MAX_429_RETRY_WAIT_MS = 15_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getHttpStatus(err: unknown): number | null {
  const anyErr = err as { status?: number; statusCode?: number }
  return anyErr?.status ?? anyErr?.statusCode ?? null
}

/** Parse RetryInfo / message hint from a Gemini 429 response (seconds → ms). */
function parse429RetryDelayMs(err: unknown): number {
  const anyErr = err as {
    errorDetails?: Array<Record<string, unknown>>
    message?: string
  }

  for (const detail of anyErr.errorDetails ?? []) {
    const type = String(detail['@type'] ?? '')
    if (type.includes('RetryInfo')) {
      const delay = detail.retryDelay
      if (typeof delay === 'string') {
        const m = delay.match(/^([\d.]+)s$/)
        if (m) return parseFloat(m[1]) * 1000
      }
    }
  }

  const msg = anyErr.message ?? ''
  const m = msg.match(/retry in ([\d.]+)s/i)
  if (m) return parseFloat(m[1]) * 1000

  return 0
}

function isTransientApiError(err: unknown): boolean {
  const status = getHttpStatus(err)
  return status === 429 || status === 503
}

let geminiCallCount = 0

export function getGeminiCallCount(): number {
  return geminiCallCount
}

export function resetGeminiCallCount(): void {
  geminiCallCount = 0
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function readCache(
  cardId: string,
  inputHash: string
): Promise<InsightContent | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('card_ai')
    .select('content, input_hash')
    .eq('card_id', cardId)
    .eq('kind', 'insight')
    .maybeSingle()

  if (!data || data.input_hash !== inputHash) return null

  try {
    return JSON.parse(data.content) as InsightContent
  } catch {
    return null
  }
}

async function writeCache(cardId: string, inputHash: string, content: InsightContent): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('card_ai').upsert(
    {
      card_id: cardId,
      kind: 'insight',
      content: JSON.stringify(content),
      input_hash: inputHash,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'card_id,kind' }
  )
}

async function tryClaimBudget(): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('try_increment_gemini_budget', {
    p_day: todayUtc(),
    p_feature: BUDGET_FEATURE,
    p_cap: DAILY_INSIGHT_CAP,
  })

  if (error) {
    // Migration not yet applied — allow generation but log loudly.
    if (
      error.code === 'PGRST202' ||
      error.message.includes('does not exist') ||
      error.message.includes('Could not find the function')
    ) {
      console.warn('[aiInsight] gemini_budget migration not applied — budget cap skipped')
      return true
    }
    console.error('[aiInsight] budget RPC error:', error.message)
    return false
  }
  return data === true
}

async function callGemini(card: CardDetail, acquired: AcquiredText): Promise<InsightContent | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[aiInsight] GEMINI_API_KEY is not set')
    throw new Error('GEMINI_API_KEY is not set')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      topP: 1,
      topK: 1,
      candidateCount: 1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: responseSchemaForCard(card),
    },
  })

  const userPrompt = buildUserPrompt(card, acquired.text, acquired.status)

  const attempt = async (): Promise<InsightContent> => {
    const result = await model.generateContent(userPrompt)
    const text = result.response.text()
    if (!text) {
      throw new Error('Empty response from Gemini')
    }

    const parsed = JSON.parse(text) as unknown
    const validated = validateInsightContent(parsed, card, acquired.status)
    if (!validated) {
      throw new Error('Invalid Insight JSON from Gemini')
    }
    return validated
  }

  /** One Gemini call; on 429, wait (per RetryInfo) and retry once. */
  const attemptWith429Retry = async (): Promise<InsightContent> => {
    try {
      return await attempt()
    } catch (err) {
      if (getHttpStatus(err) !== 429) throw err
      const waitMs = Math.min(parse429RetryDelayMs(err), MAX_429_RETRY_WAIT_MS)
      console.warn(
        `[aiInsight] Gemini 429; retrying after ${Math.round(waitMs)}ms`,
        waitMs > 0 ? '' : '(no retry-delay in response)'
      )
      if (waitMs > 0) await sleep(waitMs)
      geminiCallCount += 1
      return await attempt()
    }
  }

  geminiCallCount += 1
  try {
    return await attemptWith429Retry()
  } catch (firstError) {
    if (isTransientApiError(firstError)) throw firstError
    geminiCallCount += 1
    try {
      return await attemptWith429Retry()
    } catch (secondError) {
      if (isTransientApiError(secondError)) throw secondError
      console.warn('[aiInsight] Gemini generation failed after retry:', secondError)
      return null
    }
  }
}

function isPendingJudicial(card: CardDetail, acquired: AcquiredText): boolean {
  return (
    card.source === 'courtlistener' &&
    card.card_type === 'judicial' &&
    acquired.status === 'pending'
  )
}

export type GenerateResult =
  | { ok: true; content: InsightContent; fromCache: boolean }
  | { ok: false; reason: 'pending' | 'unavailable' }

export async function generateInsight(card: CardDetail): Promise<GenerateResult> {
  if (card.card_type === 'live') {
    return { ok: false, reason: 'unavailable' }
  }

  const legiscanVersion: BillTextVersion | null =
    card.source === 'legiscan' ? selectBillTextVersion(card.raw.texts) : null

  // Legiscan: hash from change_hash + chosen text_hash (no fetch needed for cache lookup).
  // Other sources: acquire text first because it feeds the hash.
  let acquired: Awaited<ReturnType<typeof acquireSourceText>>
  if (card.source === 'legiscan') {
    acquired = { text: '', status: 'unavailable' }
  } else {
    acquired = await acquireSourceText(card)
  }

  const inputHash = computeInputHash(card, acquired, legiscanVersion)

  const cached = await readCache(card.id, inputHash)
  if (cached) {
    return { ok: true, content: cached, fromCache: true }
  }

  // Cache miss — lazy bill-text acquisition for legiscan before Gemini.
  let billTextStatus: BillTextStatus | null = null
  if (card.source === 'legiscan') {
    const billText = await ensureBillText(card, legiscanVersion)
    billTextStatus = billText.status
    acquired = await acquireSourceText(card)
  }

  if (isPendingJudicial(card, acquired)) {
    const content = buildPendingJudicialInsight(card, acquired.status)
    await writeCache(card.id, inputHash, content)
    return { ok: true, content, fromCache: false }
  }

  if (card.source === 'legiscan' && acquired.status === 'unavailable') {
    const content = buildMetadataOnlyLegislativeInsight(card)
    const retryable =
      billTextStatus === 'fetch_failed' || billTextStatus === 'parse_failed'
    if (!retryable) {
      await writeCache(card.id, inputHash, content)
    }
    return { ok: true, content, fromCache: false }
  }

  const budgetOk = await tryClaimBudget()
  if (!budgetOk) {
    return { ok: false, reason: 'pending' }
  }

  let content: InsightContent | null
  try {
    content = await callGemini(card, acquired)
  } catch (err) {
    if (isTransientApiError(err)) {
      console.warn(
        '[aiInsight] Gemini transient error; treating as pending:',
        getHttpStatus(err),
        err instanceof Error ? err.message : String(err)
      )
      return { ok: false, reason: 'pending' }
    }

    // Non-transient failures (auth, schema issues, etc.) bubble up as real errors.
    throw err
  }

  if (!content) {
    return { ok: false, reason: 'unavailable' }
  }

  // Ensure meta reflects actual acquisition status
  content.meta = {
    ...content.meta,
    source_text: acquired.status,
    model: MODEL_NAME,
    prompt_version: PROMPT_VERSION,
  }

  await writeCache(card.id, inputHash, content)
  return { ok: true, content, fromCache: false }
}

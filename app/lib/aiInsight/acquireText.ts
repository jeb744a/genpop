import type { CardDetail } from '@/app/lib/cards/types'
import { readBillTextForInsight } from '@/app/lib/billText/acquire'
import type { AcquiredText } from './types'

const FETCH_TIMEOUT_MS = 15_000
/** Bound opinion / document text before prompting (SPEC §8). */
const MAX_TEXT_CHARS = 24_000

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function trimLongText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text

  const lower = text.toLowerCase()
  const markers = ['syllabus', 'holding', 'opinion of the court', 'background']
  let start = 0
  for (const marker of markers) {
    const idx = lower.indexOf(marker)
    if (idx >= 0 && idx < text.length * 0.6) {
      start = idx
      break
    }
  }

  const slice = text.slice(start, start + MAX_TEXT_CHARS)
  return `${slice}\n\n[Text truncated for analysis — full document at source URL]`
}

function courtListenerAuthHeader(): Record<string, string> | undefined {
  const token = process.env.COURTLISTENER_API_TOKEN
  return token ? { Authorization: `Token ${token}` } : undefined
}

async function acquireCongressText(card: CardDetail): Promise<AcquiredText> {
  const parts: string[] = []
  if (card.summary?.trim()) {
    parts.push(`CRS SUMMARY:\n${card.summary.trim()}`)
  }

  const raw = card.raw
  const title = typeof raw.title === 'string' ? raw.title : card.title
  if (title) parts.push(`TITLE: ${title}`)

  const latestAction = raw.latestAction as { actionDate?: string; text?: string } | undefined
  if (latestAction?.text) {
    parts.push(`LATEST ACTION (${latestAction.actionDate ?? 'unknown date'}): ${latestAction.text}`)
  }

  const text = parts.join('\n\n').trim()
  return {
    text,
    status: text.length > 0 ? 'available' : 'unavailable',
  }
}

async function acquireFedRegText(card: CardDetail): Promise<AcquiredText> {
  const rawTextUrl = card.raw.raw_text_url
  if (typeof rawTextUrl !== 'string' || !rawTextUrl) {
    return { text: '', status: 'unavailable' }
  }

  try {
    const res = await fetchWithTimeout(rawTextUrl)
    if (!res.ok) return { text: '', status: 'unavailable' }
    const body = (await res.text()).trim()
    if (!body) return { text: '', status: 'unavailable' }
    return { text: trimLongText(body), status: 'available' }
  } catch {
    return { text: '', status: 'unavailable' }
  }
}

interface ClusterResponse {
  sub_opinions?: string[]
}

interface OpinionResponse {
  html_with_citations?: string
  plain_text?: string
}

async function fetchOpinionText(opinionUrl: string): Promise<string | null> {
  const headers = courtListenerAuthHeader()
  try {
    const res = await fetchWithTimeout(opinionUrl, headers)
    if (!res.ok) return null
    const opinion = (await res.json()) as OpinionResponse
    if (opinion.plain_text?.trim()) return opinion.plain_text.trim()
    if (opinion.html_with_citations?.trim()) return stripHtml(opinion.html_with_citations)
    return null
  } catch {
    return null
  }
}

async function acquireCourtListenerText(card: CardDetail): Promise<AcquiredText> {
  const clusters = card.raw.clusters
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return { text: '', status: 'pending' }
  }

  const clusterUrl = clusters[0]
  if (typeof clusterUrl !== 'string' || !clusterUrl) {
    return { text: '', status: 'pending' }
  }

  const headers = courtListenerAuthHeader()
  try {
    const clusterRes = await fetchWithTimeout(clusterUrl, headers)
    if (!clusterRes.ok) return { text: '', status: 'unavailable' }

    const cluster = (await clusterRes.json()) as ClusterResponse
    const subOpinions = cluster.sub_opinions
    if (!Array.isArray(subOpinions) || subOpinions.length === 0) {
      return { text: '', status: 'pending' }
    }

    const chunks: string[] = []
    for (const opinionUrl of subOpinions.slice(0, 3)) {
      if (typeof opinionUrl !== 'string') continue
      const opinionText = await fetchOpinionText(opinionUrl)
      if (opinionText) chunks.push(opinionText)
    }

    const combined = chunks.join('\n\n---\n\n').trim()
    if (!combined) return { text: '', status: 'pending' }
    return { text: trimLongText(combined), status: 'available' }
  } catch {
    return { text: '', status: 'unavailable' }
  }
}

async function acquireLegiscanText(card: CardDetail): Promise<AcquiredText> {
  const text = await readBillTextForInsight(card)
  if (text && text.length > 0) {
    return { text, status: 'available' }
  }
  return { text: '', status: 'unavailable' }
}

export async function acquireSourceText(card: CardDetail): Promise<AcquiredText> {
  switch (card.source) {
    case 'congress':
      return acquireCongressText(card)
    case 'fedreg':
      return acquireFedRegText(card)
    case 'courtlistener':
      return acquireCourtListenerText(card)
    case 'legiscan':
      return acquireLegiscanText(card)
    default:
      return { text: '', status: 'unavailable' }
  }
}

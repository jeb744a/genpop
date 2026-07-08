import { createHash } from 'crypto'
import type { CardDetail } from '@/app/lib/cards/types'
import type { BillTextVersion } from '@/app/lib/billText/types'
import type { AcquiredText } from './types'
import { PROMPT_VERSION } from './prompt'

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

function latestTextVersionDate(raw: Record<string, unknown>): string | null {
  const textVersions = raw.textVersions as Array<{ date?: string }> | undefined
  if (!Array.isArray(textVersions) || textVersions.length === 0) return null
  const sorted = [...textVersions].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return sorted[0]?.date ?? null
}

function cluster0Id(raw: Record<string, unknown>): string | null {
  const clusters = raw.clusters
  if (!Array.isArray(clusters) || clusters.length === 0) return null
  const first = clusters[0]
  if (typeof first !== 'string') return null
  const match = first.match(/\/clusters\/(\d+)/)
  return match?.[1] ?? first
}

export function computeInputHash(
  card: CardDetail,
  acquired: AcquiredText,
  legiscanVersion?: BillTextVersion | null
): string {
  const base = { prompt_version: PROMPT_VERSION }
  let inputs: Record<string, unknown>

  switch (card.source) {
    case 'legiscan':
      inputs = {
        ...base,
        change_hash: card.raw.change_hash ?? null,
        text_hash: legiscanVersion?.text_hash ?? null,
      }
      break
    case 'congress':
      inputs = {
        ...base,
        status: card.status,
        last_action_at: card.last_action_at,
        summary_hash: card.summary ? sha256(card.summary) : null,
        text_versions_latest_date: latestTextVersionDate(card.raw),
      }
      break
    case 'fedreg':
      inputs = {
        ...base,
        external_id: card.external_id,
        text_hash: acquired.text ? sha256(acquired.text) : null,
      }
      break
    case 'courtlistener':
      inputs = {
        ...base,
        status: card.status,
        date_modified: card.raw.date_modified ?? null,
        cluster0_id: cluster0Id(card.raw),
      }
      break
    default:
      inputs = {
        ...base,
        card_id: card.id,
        status: card.status,
      }
  }

  return sha256(canonicalJson(inputs))
}

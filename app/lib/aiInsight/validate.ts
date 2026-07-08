import type { CardDetail } from '@/app/lib/cards/types'
import {
  NOT_SPECIFIED,
  PENDING_DECIDED_SENTENCE,
  slotSchemaForCard,
} from './prompt'
import type {
  InsightContent,
  InsightSlots,
  LegislativeSlots,
  ProvenanceEntry,
  SlotValue,
  SourceSnippet,
  TextAcquisitionStatus,
  WhatChangeEntry,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWhatChangesValue(raw: unknown): WhatChangeEntry[] | string {
  if (typeof raw === 'string') {
    if (raw === NOT_SPECIFIED) return NOT_SPECIFIED
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const entries = parsed
          .filter(isRecord)
          .map((item) => ({
            from: String(item.from ?? ''),
            to: String(item.to ?? ''),
          }))
          .filter((e) => e.from || e.to)
        return entries.length > 0 ? entries : NOT_SPECIFIED
      }
    } catch {
      return raw
    }
    return raw
  }
  if (Array.isArray(raw)) {
    const entries = raw
      .filter(isRecord)
      .map((item) => ({
        from: String(item.from ?? ''),
        to: String(item.to ?? ''),
      }))
      .filter((e) => e.from || e.to)
    return entries.length > 0 ? entries : NOT_SPECIFIED
  }
  return NOT_SPECIFIED
}

function parseProvenance(raw: unknown): ProvenanceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .map((p) => ({ type: String(p.type ?? ''), ref: String(p.ref ?? '') }))
    .filter((p) => p.type && p.ref)
}

function parseSnippets(raw: unknown): SourceSnippet[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const snippets = raw
    .filter(isRecord)
    .map((s) => ({
      slot: String(s.slot ?? ''),
      quote: String(s.quote ?? ''),
      location: String(s.location ?? ''),
    }))
    .filter((s) => s.slot && s.quote)
  return snippets.length > 0 ? snippets : undefined
}

function parseSlotValue(raw: unknown, slotKey: string): SlotValue | null {
  if (!isRecord(raw)) return null
  const provenance = parseProvenance(raw.provenance)
  const source_snippets = parseSnippets(raw.source_snippets)

  if (slotKey === 'what_changes') {
    const value = parseWhatChangesValue(raw.value)
    return { value, provenance, ...(source_snippets ? { source_snippets } : {}) }
  }

  const value = raw.value
  if (typeof value !== 'string' && !Array.isArray(value)) return null
  return {
    value: typeof value === 'string' ? value : JSON.stringify(value),
    provenance,
    ...(source_snippets ? { source_snippets } : {}),
  }
}

export function validateInsightContent(
  parsed: unknown,
  card: CardDetail,
  sourceTextStatus: TextAcquisitionStatus
): InsightContent | null {
  if (!isRecord(parsed)) return null
  if (parsed.schema_version !== 'insight.v1') return null
  if (parsed.card_type !== card.card_type) return null
  if (!isRecord(parsed.slots)) return null
  if (!isRecord(parsed.meta)) return null

  const slotDefs = slotSchemaForCard(card)
  const slots: Record<string, SlotValue> = {}

  for (const [key, def] of Object.entries(slotDefs)) {
    const rawSlot = parsed.slots[key]
    if (!rawSlot) {
      if (def.required) return null
      continue
    }
    const slot = parseSlotValue(rawSlot, key)
    if (!slot) return null
    slots[key] = slot
  }

  const metaSourceText = parsed.meta.source_text
  const validMetaStatus =
    metaSourceText === 'available' ||
    metaSourceText === 'unavailable' ||
    metaSourceText === 'pending'

  return {
    schema_version: 'insight.v1',
    card_type: card.card_type as InsightContent['card_type'],
    slots: slots as InsightSlots,
    meta: {
      source_text: validMetaStatus ? (metaSourceText as TextAcquisitionStatus) : sourceTextStatus,
      model: String(parsed.meta.model ?? 'gemini-2.5-flash'),
      prompt_version: String(parsed.meta.prompt_version ?? '1'),
    },
  }
}

/** Deterministic insight for pending judicial dockets with no opinion text. */
export function buildPendingJudicialInsight(
  card: CardDetail,
  sourceTextStatus: TextAcquisitionStatus
): InsightContent {
  const emptyProv: ProvenanceEntry[] = []
  const statusProv: ProvenanceEntry[] = [
    { type: 'docket_field', ref: `cards.status=${card.status ?? 'PENDING'}` },
  ]

  const notSpecified = (): SlotValue<string> => ({
    value: NOT_SPECIFIED,
    provenance: emptyProv,
  })

  const slots: InsightSlots = {
    what_was_decided: {
      value: PENDING_DECIDED_SENTENCE,
      provenance: [{ type: 'docket_field', ref: 'clusters=[]' }],
    },
    holding: notSpecified(),
    what_changes_going_forward: notSpecified(),
    still_unresolved: notSpecified(),
    current_status: {
      value: mapJudicialStatus(card.status),
      provenance: statusProv,
    },
    source_refs: notSpecified(),
  }

  return {
    schema_version: 'insight.v1',
    card_type: 'judicial',
    slots,
    meta: {
      source_text: sourceTextStatus,
      model: 'deterministic',
      prompt_version: '1',
    },
  }
}

/** Metadata-only legislative insight when bill text is unavailable (SPEC §0). */
export function buildMetadataOnlyLegislativeInsight(card: CardDetail): InsightContent {
  const emptyProv: ProvenanceEntry[] = []
  const statusProv: ProvenanceEntry[] = [
    { type: 'progress_event', ref: `cards.status=${card.status ?? 'unknown'}` },
  ]

  const notSpecified = (): SlotValue<string> => ({
    value: NOT_SPECIFIED,
    provenance: emptyProv,
  })

  const sponsors = card.raw.sponsors as Array<{ name?: string }> | undefined
  const sponsorNames = sponsors?.map((s) => s.name).filter(Boolean).join(', ')
  const whoAffected = sponsorNames
    ? `Sponsors listed in bill metadata: ${sponsorNames}.`
    : NOT_SPECIFIED

  const supplements = card.raw.supplements as unknown[] | undefined
  const slots: LegislativeSlots = {
    what_it_does: notSpecified(),
    what_changes: notSpecified(),
    who_is_affected: {
      value: whoAffected,
      provenance: sponsors?.length
        ? [{ type: 'history_entry', ref: 'raw.sponsors[]' }]
        : emptyProv,
    },
    current_status: {
      value: mapLegislativeStatus(card.status),
      provenance: statusProv,
    },
    source_refs: notSpecified(),
  }

  if (Array.isArray(supplements) && supplements.length > 0) {
    slots.fiscal_note = {
      value: 'A fiscal note supplement is listed in bill metadata; text not parsed.',
      provenance: [{ type: 'supplement', ref: 'raw.supplements[]' }],
    }
  }

  return {
    schema_version: 'insight.v1',
    card_type: 'legislative',
    slots,
    meta: {
      source_text: 'unavailable',
      model: 'deterministic',
      prompt_version: '1',
    },
  }
}

function mapJudicialStatus(status: string | null): string {
  switch (status) {
    case 'PENDING':
      return 'Filed; not yet decided.'
    case 'ARGUED':
      return 'Oral argument held; awaiting decision.'
    case 'DECIDED':
      return 'Decided.'
    default:
      return status ?? NOT_SPECIFIED
  }
}

export function mapLegislativeStatus(status: string | null): string {
  switch (status) {
    case 'INTRODUCED':
      return 'Introduced; pending committee consideration.'
    case 'PASSED_CHAMBER':
      return 'Passed the chamber of origin; pending in the second chamber.'
    case 'PASSED':
      return 'Passed both chambers; pending enactment.'
    case 'ENACTED':
      return 'Enacted into law.'
    case 'VETOED':
      return 'Vetoed.'
    case 'FAILED':
      return 'Failed.'
    case 'TO_PRESIDENT':
      return 'Presented to the President.'
    default:
      return status ?? NOT_SPECIFIED
  }
}

export function mapExecutiveStatus(status: string | null): string {
  switch (status) {
    case 'EO_ISSUED':
      return 'Executive order issued.'
    case 'PROCLAMATION':
      return 'Proclamation issued.'
    case 'PRES_ACTION':
      return 'Presidential action published.'
    default:
      return status ?? NOT_SPECIFIED
  }
}

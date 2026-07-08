import { SchemaType, type ResponseSchema } from '@google/generative-ai'
import type { CardDetail } from '@/app/lib/cards/types'
import type { TextAcquisitionStatus } from './types'

export const PROMPT_VERSION = '1'
export const MODEL_NAME = 'gemini-2.5-flash'

export const SYSTEM_PROMPT = `You are a neutral legislative analyst for GenPop. You produce a STRUCTURED,
objective-register explainer of a single U.S. government action. You are not an
advocate, commentator, or journalist. You report what a document does, not whether
it is good, bad, important, or controversial.

HARD RULES:
1. Output ONLY valid JSON matching the provided schema. No prose outside the JSON.
2. Fill every required slot. If the SOURCE TEXT does not support a slot, output the
   exact string "Not specified in the source". NEVER infer, guess, or supply
   outside knowledge.
3. Objective register:
   - No evaluative adjectives/adverbs (harsh, sweeping, landmark, common-sense,
     dangerous, etc.). Use numbers to convey magnitude.
   - No framing verbs (cracks down, guts, protects, attacks). Use neutral verbs
     (changes, sets, removes, requires, permits, establishes, repeals).
   - Report stated PURPOSE and MECHANISM separately. Never claim the mechanism
     achieves the purpose.
   - For crime, sexual-offense, or other grim subject matter: factual and clinical.
     No euphemism, no lurid or sensational detail. State penalties as legal terms
     and numbers.
4. Every filled slot must include:
   - "provenance": pointers to where in the SOURCE TEXT the claim is grounded.
   - "source_snippets" where a short verbatim quote (<= 40 words) supports the slot.
     Quotes must be exact. Omit source_snippets when no quote is available.
5. Do not exceed the schema. Do not add slots.
6. For the "what_changes" slot on legislative cards: when concrete from→to changes
   exist, set value to a JSON string encoding an array of objects with "from" and
   "to" keys. Otherwise use the exact string "Not specified in the source".
7. Omit optional slots entirely when the source lacks the information (do not include
   the key). Required slots must always be present.`

const LEGISLATIVE_SLOT_SCHEMA = {
  what_it_does: { required: true, description: '1–2 neutral sentences: the action the bill takes' },
  what_changes: {
    required: true,
    description: 'concrete from → to changes, or "Not specified in the source"',
  },
  who_is_affected: { required: true, description: 'persons/entities/agencies the bill binds or affects' },
  effective_date: { required: false, description: 'date/condition the change takes effect' },
  sunset: { required: false, description: 'expiration/repeal date if any' },
  fiscal_note: { required: false, description: 'cost/appropriation if scored' },
  current_status: { required: true, description: 'plain-language status from cards.status' },
  source_refs: { required: true, description: 'section/citation references' },
}

const EXECUTIVE_SLOT_SCHEMA = {
  what_it_directs: { required: true, description: '1–2 neutral sentences: what the action orders' },
  what_changes_operationally: { required: true, description: 'concrete operational change(s)' },
  who_is_bound: { required: true, description: 'agencies/officials/parties directed' },
  effective_date: { required: false, description: 'when it takes effect' },
  legal_authority: { required: false, description: 'statute/constitutional authority cited' },
  current_status: { required: true, description: 'plain-language status from cards.status' },
  source_refs: { required: true, description: 'section numbers within the document' },
}

const JUDICIAL_SLOT_SCHEMA = {
  what_was_decided: { required: true, description: '1–2 neutral sentences' },
  holding: { required: true, description: 'the holding in plain terms' },
  what_changes_going_forward: { required: true, description: 'practical effect of the ruling' },
  still_unresolved: { required: true, description: 'what the opinion leaves open' },
  current_status: { required: true, description: 'plain-language status from cards.status' },
  source_refs: { required: true, description: 'opinion paragraph/page references' },
}

export function slotSchemaForCard(card: CardDetail): Record<string, { required: boolean; description: string }> {
  if (card.card_type === 'legislative') return LEGISLATIVE_SLOT_SCHEMA
  if (card.card_type === 'executive') return EXECUTIVE_SLOT_SCHEMA
  if (card.card_type === 'judicial') return JUDICIAL_SLOT_SCHEMA
  return LEGISLATIVE_SLOT_SCHEMA
}

const provenanceSchema = {
  type: SchemaType.OBJECT,
  properties: {
    type: { type: SchemaType.STRING },
    ref: { type: SchemaType.STRING },
  },
  required: ['type', 'ref'],
}

const snippetSchema = {
  type: SchemaType.OBJECT,
  properties: {
    slot: { type: SchemaType.STRING },
    quote: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING },
  },
  required: ['slot', 'quote', 'location'],
}

const slotObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    value: { type: SchemaType.STRING },
    provenance: {
      type: SchemaType.ARRAY,
      items: provenanceSchema,
    },
    source_snippets: {
      type: SchemaType.ARRAY,
      items: snippetSchema,
    },
  },
  required: ['value', 'provenance'],
}

function buildSlotsSchema(
  slotDefs: Record<string, { required: boolean; description: string }>
): ResponseSchema {
  const properties: Record<string, ResponseSchema> = {}
  const required: string[] = []

  for (const [key, def] of Object.entries(slotDefs)) {
    properties[key] = slotObjectSchema as ResponseSchema
    if (def.required) required.push(key)
  }

  return {
    type: SchemaType.OBJECT,
    properties,
    required,
  }
}

export function responseSchemaForCard(card: CardDetail): ResponseSchema {
  const slotDefs = slotSchemaForCard(card)
  return {
    type: SchemaType.OBJECT,
    properties: {
      schema_version: { type: SchemaType.STRING },
      card_type: { type: SchemaType.STRING },
      slots: buildSlotsSchema(slotDefs),
      meta: {
        type: SchemaType.OBJECT,
        properties: {
          source_text: { type: SchemaType.STRING },
          model: { type: SchemaType.STRING },
          prompt_version: { type: SchemaType.STRING },
        },
        required: ['source_text', 'model', 'prompt_version'],
      },
    },
    required: ['schema_version', 'card_type', 'slots', 'meta'],
  }
}

function trimRawForPrompt(card: CardDetail): Record<string, unknown> {
  const raw = card.raw
  const trimmed: Record<string, unknown> = {}

  if (card.source === 'legiscan') {
    trimmed.bill_number = raw.bill_number
    trimmed.state = raw.state
    trimmed.status = raw.status
    trimmed.status_date = raw.status_date
    trimmed.sponsors = raw.sponsors
    trimmed.history = Array.isArray(raw.history) ? raw.history.slice(-5) : raw.history
    trimmed.supplements = raw.supplements
    trimmed.progress = raw.progress
    trimmed.change_hash = raw.change_hash
  } else if (card.source === 'congress') {
    trimmed.latestAction = raw.latestAction
    trimmed.sponsors = raw.sponsors
    trimmed.laws = raw.laws
    trimmed.introducedDate = raw.introducedDate
    trimmed.type = raw.type
    trimmed.number = raw.number
    trimmed.congress = raw.congress
  } else if (card.source === 'fedreg') {
    trimmed.document_number = raw.document_number
    trimmed.subtype = raw.subtype
    trimmed.signing_date = raw.signing_date
    trimmed.publication_date = raw.publication_date
    trimmed.president = raw.president
    trimmed.agencies = raw.agencies
  } else if (card.source === 'courtlistener') {
    trimmed.docket_number = raw.docket_number
    trimmed.court_id = raw.court_id
    trimmed.date_filed = raw.date_filed
    trimmed.date_argued = raw.date_argued
    trimmed.date_terminated = raw.date_terminated
    trimmed.date_modified = raw.date_modified
    trimmed.clusters = raw.clusters
  }

  return trimmed
}

function regionLine(card: CardDetail): string {
  return card.region ? ` / ${card.region}` : ''
}

export function buildUserPrompt(
  card: CardDetail,
  acquiredText: string,
  sourceTextStatus: TextAcquisitionStatus
): string {
  const slotSchema = slotSchemaForCard(card)
  const trimmedRaw = trimRawForPrompt(card)

  const sourceTextBlock =
    acquiredText.trim().length > 0
      ? acquiredText
      : sourceTextStatus === 'pending'
        ? '(No opinion text — case filed, not yet decided.)'
        : '(Primary source text not available — use STRUCTURED METADATA only for status-related slots; set substance slots to "Not specified in the source".)'

  return `CARD TYPE: ${card.card_type}            SOURCE: ${card.source}
TITLE: ${card.title}
CURRENT STATUS (cards.status): ${card.status ?? 'unknown'}
JURISDICTION: ${card.sphere}${regionLine(card)}

SLOT SCHEMA (fill exactly these keys): ${JSON.stringify(slotSchema)}

SOURCE TEXT (the only ground truth you may use):
"""
${sourceTextBlock}
"""

STRUCTURED METADATA (for status, dates, sponsors, fiscal-note existence only —
not a substitute for SOURCE TEXT):
${JSON.stringify(trimmedRaw)}

Return the JSON object now.`
}

export const NOT_SPECIFIED = 'Not specified in the source'
export const PENDING_DECIDED_SENTENCE =
  'The case has been filed; no decision has been issued.'

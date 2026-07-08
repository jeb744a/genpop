import type { CardDetail } from '@/app/lib/cards/types'

export type TextAcquisitionStatus = 'available' | 'unavailable' | 'pending'

export interface AcquiredText {
  text: string
  status: TextAcquisitionStatus
}

export interface ProvenanceEntry {
  type: string
  ref: string
}

export interface SourceSnippet {
  slot: string
  quote: string
  location: string
}

export interface SlotValue<T = unknown> {
  value: T
  provenance: ProvenanceEntry[]
  source_snippets?: SourceSnippet[]
}

export interface WhatChangeEntry {
  from: string
  to: string
}

export type LegislativeSlots = {
  what_it_does: SlotValue<string>
  what_changes: SlotValue<WhatChangeEntry[] | string>
  who_is_affected: SlotValue<string>
  effective_date?: SlotValue<string>
  sunset?: SlotValue<string>
  fiscal_note?: SlotValue<string>
  current_status: SlotValue<string>
  source_refs: SlotValue<string>
}

export type ExecutiveSlots = {
  what_it_directs: SlotValue<string>
  what_changes_operationally: SlotValue<string>
  who_is_bound: SlotValue<string>
  effective_date?: SlotValue<string>
  legal_authority?: SlotValue<string>
  current_status: SlotValue<string>
  source_refs: SlotValue<string>
}

export type JudicialSlots = {
  what_was_decided: SlotValue<string>
  holding: SlotValue<string>
  what_changes_going_forward: SlotValue<string>
  still_unresolved: SlotValue<string>
  current_status: SlotValue<string>
  source_refs: SlotValue<string>
}

export type InsightSlots = LegislativeSlots | ExecutiveSlots | JudicialSlots

export interface InsightContent {
  schema_version: 'insight.v1'
  card_type: 'legislative' | 'executive' | 'judicial'
  slots: InsightSlots
  meta: {
    source_text: TextAcquisitionStatus
    model: string
    prompt_version: string
  }
}

export type InsightApiState = 'ready' | 'pending' | 'unavailable'

export interface InsightApiResponse {
  state: InsightApiState
  content?: InsightContent
  source_url?: string | null
  message?: string
}

export type InsightCard = CardDetail

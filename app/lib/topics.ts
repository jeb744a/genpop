/**
 * Fixed policy-topic taxonomy applied to cards (at ingestion) and posts.
 * Gemini classification prompts must constrain output to this list.
 */
export const POLICY_TOPICS = [
  'congress_legislation',
  'executive_action',
  'courts_judiciary',
  'elections_voting',
  'immigration_border',
  'foreign_policy_defense',
  'economy_trade',
  'taxes_budget',
  'healthcare',
  'education',
  'climate_energy',
  'tech_privacy',
  'civil_rights',
  'criminal_justice',
  'gun_policy',
  'labor_unions',
  'housing',
  'agriculture_rural',
  'state_local_government',
  'other_civic',
] as const

export type PolicyTopic = (typeof POLICY_TOPICS)[number]

export const POLICY_TOPIC_SET = new Set<string>(POLICY_TOPICS)

/** Non-civic tags that must not clear the live-news topic gate. */
export const NON_CIVIC_MARKERS = [
  'sports',
  'celebrity',
  'entertainment',
  'lifestyle',
  'culture',
] as const

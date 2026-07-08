import type { BillTextVersion } from './types'

/** Bill-text type_ids per SPEC_legiscan_pdf.md §1 */
export const BILL_TEXT_TYPE_IDS = new Set([1, 2, 3, 4, 5, 6, 10, 11])

function isBillTextVersion(entry: unknown): entry is BillTextVersion {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.doc_id === 'number' &&
    typeof e.type_id === 'number' &&
    typeof e.date === 'string' &&
    e.mime === 'application/pdf' &&
    typeof e.text_hash === 'string' &&
    typeof e.state_link === 'string'
  )
}

/**
 * Select the operative bill-text version from raw.texts[] (SPEC §1).
 * Latest date → highest type_id → highest doc_id.
 */
export function selectBillTextVersion(texts: unknown): BillTextVersion | null {
  if (!Array.isArray(texts)) return null

  const candidates = texts
    .filter(isBillTextVersion)
    .filter((t) => BILL_TEXT_TYPE_IDS.has(t.type_id))

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date)
    if (dateCmp !== 0) return dateCmp
    if (b.type_id !== a.type_id) return b.type_id - a.type_id
    return b.doc_id - a.doc_id
  })

  return candidates[0]
}

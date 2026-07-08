import type { FRDocumentListResponse } from './types'

const BASE_URL = 'https://www.federalregister.gov/api/v1'

// Fields we need from every document. Requested explicitly because FR omits
// many fields from the default payload.
const FIELDS = [
  'document_number',
  'type',
  'subtype',
  'title',
  'abstract',
  'publication_date',
  'signing_date',
  'executive_order_number',
  'president',
  'agencies',
  'html_url',
  'pdf_url',
  'body_html_url',
  'raw_text_url',
]

function buildUrl(fromDate: string, page: number): string {
  // Build manually: URLSearchParams encodes [] as %5B%5D which FR accepts,
  // but building by hand makes the intent explicit.
  const parts = [
    `conditions[type][]=PRESDOCU`,
    `conditions[publication_date][gte]=${encodeURIComponent(fromDate)}`,
    `order=newest`,
    `per_page=100`,
    `page=${page}`,
    ...FIELDS.map((f) => `fields[]=${encodeURIComponent(f)}`),
  ]
  return `${BASE_URL}/documents.json?${parts.join('&')}`
}

export async function fetchDocumentPage(
  fromDate: string,
  page: number
): Promise<FRDocumentListResponse> {
  const url = buildUrl(fromDate, page)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Federal Register API ${res.status} on /documents.json`)
  return res.json() as Promise<FRDocumentListResponse>
}

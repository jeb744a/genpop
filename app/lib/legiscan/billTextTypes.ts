export interface BillTextDocument {
  doc_id: number
  mime: string
  text_size: number
  text_hash: string
  state_link: string
  doc: string
}

export interface GetBillTextApiResponse {
  status: string
  text: BillTextDocument
}

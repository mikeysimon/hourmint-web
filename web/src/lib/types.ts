export type DetailLevel = 'summary' | 'project' | 'detailed'

export type ClientRecord = {
  id: number
  name: string
  email: string | null
  company: string | null
  notes: string | null
  created_at: string
}

export type ProjectRecord = {
  id: number
  client_id: number
  name: string
  rate: number
  description: string | null
  active: boolean
  created_at: string
}

export type TimeEntryRecord = {
  id: number
  project_id: number
  start_at: string
  end_at: string
  hours: number
  description: string
  invoiced: boolean
  invoice_id: number | null
  created_at: string
}

export type InvoiceRecord = {
  id: number
  invoice_number: string
  client_id: number
  generated_at: string
  detail_level: DetailLevel
  subtotal: number
  pdf_path: string
  summary_pdf_path: string | null
  project_pdf_path: string | null
  detailed_pdf_path: string | null
  status: 'paid' | 'unpaid'
  paid_at: string | null
}

export type SettingRecord = {
  key: string
  value: string
}

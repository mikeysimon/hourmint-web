import { jsPDF } from 'jspdf'
import { format } from 'date-fns'

import type { ClientRecord, DetailLevel, ProjectRecord, TimeEntryRecord } from './types'

type InvoiceBundleInput = {
  invoiceNumber: string
  client: ClientRecord
  entries: TimeEntryRecord[]
  businessName: string
  detailLevel: DetailLevel
  logoUrl: string
  projectsById: Map<number, ProjectRecord>
}

export async function createInvoicePdfBundle(input: InvoiceBundleInput) {
  const logoDataUrl = input.logoUrl ? await fetchAsDataUrl(input.logoUrl).catch(() => '') : ''

  return {
    summary: createSingleInvoicePdf({ ...input, variant: 'summary', logoDataUrl }),
    project: createSingleInvoicePdf({ ...input, variant: 'project', logoDataUrl }),
    detailed: createSingleInvoicePdf({ ...input, variant: 'detailed', logoDataUrl }),
  }
}

function createSingleInvoicePdf(
  input: InvoiceBundleInput & { variant: DetailLevel; logoDataUrl: string },
) {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
  })

  const subtotal = input.entries.reduce((sum, entry) => {
    const project = input.projectsById.get(entry.project_id)
    return sum + entry.hours * Number(project?.rate ?? 0)
  }, 0)

  const groupedEntries = input.entries.reduce<Record<string, TimeEntryRecord[]>>((groups, entry) => {
    const projectName = input.projectsById.get(entry.project_id)?.name ?? 'Unknown project'
    groups[projectName] = groups[projectName] ?? []
    groups[projectName].push(entry)
    return groups
  }, {})

  let y = 58
  const pageHeight = 792
  const pageWidth = 612
  const left = 44
  const panelX = 24
  const panelY = 24
  const panelWidth = pageWidth - 48
  const panelHeight = pageHeight - 48

  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, pageWidth, pageHeight, 'F')
  doc.setFillColor(244, 251, 249)
  doc.roundedRect(panelX, panelY, panelWidth, panelHeight, 18, 18, 'F')

  if (input.logoDataUrl) {
    doc.addImage(input.logoDataUrl, 'PNG', left, y, 110, 34)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(21, 45, 61)
  doc.text(input.businessName, left, input.logoDataUrl ? 112 : 78)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(91, 111, 126)
  doc.text('Professional services invoice', left, input.logoDataUrl ? 128 : 94)

  doc.setDrawColor(197, 228, 217)
  doc.line(312, 60, 556, 60)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(91, 111, 126)
  doc.text('BILLED TO', 312, 84)
  doc.text('INVOICE', 312, 106)
  doc.text('DATE', 312, 128)
  doc.text('DETAIL', 312, 150)

  doc.setTextColor(21, 45, 61)
  doc.text(input.client.name, 402, 84)
  doc.text(input.invoiceNumber, 402, 106)
  doc.text(format(new Date(), 'MMM d, yyyy'), 402, 128)
  doc.text(labelForDetail(input.variant), 402, 150)

  y = 188

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(left, y, 516, 58, 14, 14, 'F')
  summaryCell(doc, left + 22, y + 20, 'Projects', String(Object.keys(groupedEntries).length))
  summaryCell(doc, left + 132, y + 20, 'Entries', String(input.entries.length))
  summaryCell(doc, left + 242, y + 20, 'Hours', input.entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(2))
  summaryCell(doc, left + 352, y + 20, 'Subtotal', currency(subtotal))
  y += 88

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(21, 45, 61)
  doc.text('Work Summary', left, y)
  y += 22

  for (const [projectName, entries] of Object.entries(groupedEntries)) {
    const project = input.projectsById.get(entries[0].project_id)
    const projectTotal = entries.reduce((sum, entry) => sum + entry.hours * Number(project?.rate ?? 0), 0)
    const projectHours = entries.reduce((sum, entry) => sum + entry.hours, 0)

    y = ensureSpace(doc, y, 72, { panelX, panelY, panelWidth, panelHeight })
    doc.setFillColor(232, 251, 243)
    doc.roundedRect(left, y, 516, 24, 10, 10, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(21, 45, 61)
    doc.text(projectName, left + 14, y + 16)
    doc.setFontSize(9)
    doc.setTextColor(72, 95, 112)
    doc.text(`${currency(Number(project?.rate ?? 0))}/hr  •  ${projectHours.toFixed(2)} hrs  •  ${currency(projectTotal)}`, 546, y + 16, { align: 'right' })
    y += 42

    if (input.variant === 'summary') {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text('Project billed at the rate shown above.', left + 8, y)
      y += 14
      continue
    }

    if (input.variant === 'project') {
      const copy = [...new Set(entries.map((entry) => entry.description.trim()).filter(Boolean))].join('; ') || 'General project work'
      y = writeWrappedText(doc, copy, left + 8, y, 500, 13, { panelX, panelY, panelWidth, panelHeight })
      y += 10
      continue
    }

    for (const entry of entries) {
      y = ensureSpace(doc, y, 68, { panelX, panelY, panelWidth, panelHeight })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(21, 45, 61)
      doc.text(
        `${format(new Date(entry.start_at), 'MMM d, yyyy h:mm a')} - ${format(new Date(entry.end_at), 'h:mm a')}`,
        left + 8,
        y,
      )
      doc.text(`${entry.hours.toFixed(2)} hrs  •  ${currency(entry.hours * Number(project?.rate ?? 0))}`, 546, y, {
        align: 'right',
      })
      y += 16
      y = writeWrappedText(doc, entry.description, left + 8, y, 500, 12, { panelX, panelY, panelWidth, panelHeight })
      y += 8
    }
  }

  y = ensureSpace(doc, y, 60, { panelX, panelY, panelWidth, panelHeight })
  doc.setFillColor(232, 251, 243)
  doc.roundedRect(358, Math.min(y + 6, 700), 176, 34, 12, 12, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(21, 45, 61)
  doc.text('Invoice Total', 372, Math.min(y + 28, 722))
  doc.text(currency(subtotal), 520, Math.min(y + 28, 722), { align: 'right' })

  return doc.output('blob')
}

function summaryCell(doc: jsPDF, x: number, y: number, label: string, value: string) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(91, 111, 126)
  doc.text(label.toUpperCase(), x, y)
  doc.setFontSize(12.5)
  doc.setTextColor(21, 45, 61)
  doc.text(value, x, y + 18)
}

function writeWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  pagePanel: { panelX: number; panelY: number; panelWidth: number; panelHeight: number },
) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(72, 95, 112)
  const lines = doc.splitTextToSize(text || 'General work completed', width)
  lines.forEach((line: string) => {
    y = ensureSpace(doc, y, 18, pagePanel)
    doc.text(line, x, y)
    y += lineHeight
  })
  return y
}

function ensureSpace(
  doc: jsPDF,
  y: number,
  needed: number,
  pagePanel: { panelX: number; panelY: number; panelWidth: number; panelHeight: number },
) {
  if (y + needed < 708) return y
  doc.addPage()
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, 612, 792, 'F')
  doc.setFillColor(244, 251, 249)
  doc.roundedRect(pagePanel.panelX, pagePanel.panelY, pagePanel.panelWidth, pagePanel.panelHeight, 18, 18, 'F')
  return 56
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function labelForDetail(value: DetailLevel) {
  if (value === 'project') return 'By Project'
  if (value === 'detailed') return 'Detailed Line Items'
  return 'Summary'
}

async function fetchAsDataUrl(url: string) {
  const response = await fetch(url)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

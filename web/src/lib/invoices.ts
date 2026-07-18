import { jsPDF } from 'jspdf'

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

type EnrichedEntry = TimeEntryRecord & {
  project_name: string
  rate: number
}

type PdfContext = {
  doc: jsPDF
  width: number
  height: number
  margin: number
  contentWidth: number
  footerIconDataUrl: string
}

export async function createInvoicePdfBundle(input: InvoiceBundleInput) {
  const [logoDataUrl, footerIconDataUrl] = await Promise.all([
    input.logoUrl ? fetchAsDataUrl(input.logoUrl).catch(() => '') : Promise.resolve(''),
    fetchAsDataUrl('/icons/hourmint-app-icon.png').catch(() => ''),
  ])

  return {
    summary: createSingleInvoicePdf({ ...input, variant: 'summary', logoDataUrl, footerIconDataUrl }),
    project: createSingleInvoicePdf({ ...input, variant: 'project', logoDataUrl, footerIconDataUrl }),
    detailed: createSingleInvoicePdf({ ...input, variant: 'detailed', logoDataUrl, footerIconDataUrl }),
  }
}

function createSingleInvoicePdf(
  input: InvoiceBundleInput & { variant: DetailLevel; logoDataUrl: string; footerIconDataUrl: string },
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const width = 612
  const height = 792
  const margin = 39.6
  const contentWidth = width - (2 * margin)
  const context: PdfContext = {
    doc,
    width,
    height,
    margin,
    contentWidth,
    footerIconDataUrl: input.footerIconDataUrl,
  }

  const entries = input.entries.map((entry) => {
    const project = input.projectsById.get(entry.project_id)
    return {
      ...entry,
      project_name: project?.name ?? 'Unknown project',
      rate: Number(project?.rate ?? 0),
    }
  })

  const subtotal = roundCurrency(entries.reduce((sum, entry) => sum + entry.hours * entry.rate, 0))

  let y = height - margin
  y = drawHeader(context, input.invoiceNumber, input.client.name, input.businessName, input.variant, input.logoDataUrl, y)
  y -= 14
  y = drawSummary(context, entries, subtotal, input.variant, y)
  y -= 18
  y = drawItems(context, input.variant, entries, y)

  if (y < margin + 70) {
    finishPage(context)
    doc.addPage()
    y = height - margin
  }

  setStroke(doc, '#D7E7E4', 1)
  drawLine(context, margin, y, width - margin, y)
  y -= 20

  const totalBoxWidth = 204
  const totalBoxHeight = 34
  const totalBoxY = y - 18
  fillRoundedRect(context, width - margin - totalBoxWidth, totalBoxY, totalBoxWidth, totalBoxHeight, 12, '#E8FBF3')
  setFont(doc, 'bold', 13, '#486172')
  const totalTextY = totalBoxY + totalBoxHeight / 2 + 4.5
  drawText(context, 'Invoice Total', width - margin - totalBoxWidth + 15, totalTextY)
  setFont(doc, 'bold', 13, '#173042')
  drawText(context, currency(subtotal), width - margin - 15, totalTextY, { align: 'right' })

  finishPage(context)
  return doc.output('blob')
}

function drawHeader(
  context: PdfContext,
  invoiceNumber: string,
  clientName: string,
  businessName: string,
  detailLevel: DetailLevel,
  logoDataUrl: string,
  y: number,
) {
  const { doc, width, margin, contentWidth } = context
  const topY = y - 6
  const logoLeft = margin
  const rightX = margin + 3.18 * 72
  const rightWidth = contentWidth - (rightX - margin)
  let drewLogo = false

  if (logoDataUrl) {
    const dimensions = fitLogo(logoDataUrl, 3.1 * 72, 1.3 * 72)
    addImageAtBottomLeft(context, logoDataUrl, logoLeft, topY - dimensions.height, dimensions.width, dimensions.height)
    drewLogo = true
  }

  setFont(doc, 'bold', 17, '#173042')
  drawText(context, fitText(doc, businessName, 'helvetica', 'bold', 17, rightWidth - 4), rightX, topY - 2)

  setFont(doc, 'normal', 10.5, '#64748B')
  drawText(context, 'Professional services invoice', rightX, topY - 18)

  setStroke(doc, '#DCEAE7', 1)
  drawLine(context, rightX, topY - 28, width - margin, topY - 28)

  const metaStartY = topY - 46
  const labelX = rightX
  const valueX = rightX + 112

  setFont(doc, 'bold', 9.5, '#64748B')
  drawText(context, 'BILLED TO', labelX, metaStartY)
  drawText(context, 'INVOICE', labelX, metaStartY - 18)
  drawText(context, 'DATE', labelX, metaStartY - 36)
  drawText(context, 'DETAIL', labelX, metaStartY - 54)

  setFont(doc, 'bold', 11, '#173042')
  drawText(context, fitText(doc, clientName, 'helvetica', 'bold', 11, rightWidth - 122), valueX, metaStartY)
  drawText(context, invoiceNumber, valueX, metaStartY - 18)
  drawText(context, formatDate(new Date()), valueX, metaStartY - 36)
  drawText(context, fitText(doc, detailLabel(detailLevel), 'helvetica', 'bold', 11, rightWidth - 122), valueX, metaStartY - 54)

  const headerBottom = Math.min(topY - (drewLogo ? 1.14 * 72 : 0), metaStartY - 60)
  setStroke(doc, '#BEE7D4', 2)
  drawLine(context, margin, headerBottom - 10, width - margin, headerBottom - 10)
  return headerBottom - 24
}

function drawSummary(context: PdfContext, entries: EnrichedEntry[], subtotal: number, detailLevel: DetailLevel, y: number) {
  const { doc, margin, contentWidth } = context
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const projects = new Set(entries.map((entry) => entry.project_name)).size
  const summary = [
    ['Detail Level', detailLabel(detailLevel)],
    ['Projects', String(projects)],
    ['Time Entries', String(entries.length)],
    ['Hours', formatHours(totalHours)],
    ['Subtotal', currency(subtotal)],
  ] as const
  const weights = [1.08, 0.82, 0.94, 0.78, 0.98]
  const boxHeight = 44
  const boxY = y - boxHeight

  fillRoundedRect(context, margin, boxY, contentWidth, boxHeight, 16, '#F6FBFA')

  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  const cellWidths = weights.map((value) => contentWidth * (value / totalWeight))
  let cellX = margin

  summary.forEach(([heading, value], index) => {
    const currentWidth = cellWidths[index]
    if (index > 0) {
      setStroke(doc, '#E2ECE9', 1)
      drawLine(context, cellX, boxY + 7, cellX, boxY + boxHeight - 7)
    }
    setFont(doc, 'bold', 9, '#64748B')
    drawText(context, heading.toUpperCase(), cellX + currentWidth / 2, y - 14, { align: 'center' })

    const valueFont = index === 0 ? 10 : 14
    setFont(doc, 'bold', valueFont, '#173042')
    const finalValue =
      index === 0 ? fitText(doc, value, 'helvetica', 'bold', valueFont, Math.max(88, currentWidth - 22)) : value
    drawText(context, finalValue, cellX + currentWidth / 2, y - 27, { align: 'center' })
    cellX += currentWidth
  })

  return boxY
}

function drawItems(context: PdfContext, detailLevel: DetailLevel, entries: EnrichedEntry[], y: number) {
  const { doc, width, margin, contentWidth } = context
  const grouped = new Map<string, EnrichedEntry[]>()
  for (const entry of entries) {
    const current = grouped.get(entry.project_name) ?? []
    current.push(entry)
    grouped.set(entry.project_name, current)
  }

  setFont(doc, 'bold', 16, '#173042')
  drawText(context, 'Work Summary', margin, y)
  y -= 12

  for (const [projectName, projectEntries] of grouped.entries()) {
    const projectHours = projectEntries.reduce((sum, item) => sum + item.hours, 0)
    const projectTotal = projectEntries.reduce((sum, item) => sum + item.hours * item.rate, 0)
    const projectRate = projectEntries[0].rate
    y = ensurePage(context, y)

    const summaryText = `Rate ${currency(projectRate)}/hr   •   ${formatHours(projectHours)} hrs   •   ${currency(projectTotal)}`
    const summaryWidth = doc.getTextWidth(summaryText)
    const bubbleHeight = 23
    const bubbleY = y - 15

    fillRoundedRect(context, margin, bubbleY, contentWidth, bubbleHeight, 11, '#E8FBF3')
    setFont(doc, 'bold', 11.5, '#173042')
    drawText(
      context,
      fitText(doc, projectName, 'helvetica', 'bold', 11.5, Math.max(140, contentWidth - summaryWidth - 54)),
      margin + 18,
      bubbleY + 15.5,
    )
    setFont(doc, 'bold', 9.5, '#4A5E73')
    drawText(context, summaryText, width - margin - 18, bubbleY + 15.5, { align: 'right' })
    y = bubbleY - 12

    if (detailLevel === 'summary') {
      setFont(doc, 'normal', 10, '#4A5E73')
      drawText(context, 'Project billed at the rate shown above.', margin + 6, y)
      y -= 10
      drawSeparator(context, margin, width, y)
      y -= 7
      continue
    }

    if (detailLevel === 'project') {
      const descriptions = [...new Set(projectEntries.map((item) => item.description.trim()).filter(Boolean))].sort()
      const summaryTextProject = descriptions.length ? descriptions.join('; ') : 'General project work'
      y = drawWrappedText(context, summaryTextProject, margin + 4, y, contentWidth - 8, {
        fontSize: 9.5,
        lineHeight: 11,
      })
      drawSeparator(context, margin, width, y - 2)
      y -= 7
      continue
    }

    for (const item of projectEntries) {
      const descriptionText = item.description.trim() || 'General work completed'
      const detailMetaReserve = 156
      const descriptionWidth = Math.max(210, contentWidth - 28 - detailMetaReserve)
      const wrappedLines = wrapText(doc, descriptionText, 'helvetica', 'normal', 9.5, descriptionWidth)
      const blockHeight = 29 + wrappedLines.length * 12
      y = ensureSpace(context, y, blockHeight + 3)

      setFont(doc, 'bold', 9.5, '#173042')
      drawText(context, `${formatDateTime(item.start_at)} - ${formatTime(item.end_at)}`, margin + 14, y)
      drawText(context, `${formatHours(item.hours)} hrs   •   ${currency(item.hours * item.rate)}`, width - margin - 14, y, {
        align: 'right',
      })
      y -= 18

      y = drawWrappedText(context, descriptionText, margin + 14, y, descriptionWidth, {
        fontSize: 9.5,
        lineHeight: 12,
      })
      drawSeparator(context, margin, width, y - 1)
      y -= 12
    }
  }

  return y
}

function drawWrappedText(
  context: PdfContext,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options: { fontSize: number; lineHeight: number; fontName?: 'helvetica'; fontStyle?: 'normal' | 'bold'; color?: string },
) {
  const { doc } = context
  const fontName = options.fontName ?? 'helvetica'
  const fontStyle = options.fontStyle ?? 'normal'
  const color = options.color ?? '#4A5E73'
  const lines = wrapText(doc, text, fontName, fontStyle, options.fontSize, maxWidth)

  doc.setFont(fontName, fontStyle)
  doc.setFontSize(options.fontSize)
  doc.setTextColor(color)
  for (const line of lines) {
    y = ensurePage(context, y)
    drawText(context, line, x, y)
    y -= options.lineHeight
  }
  return y
}

function wrapText(
  doc: jsPDF,
  text: string,
  fontName: 'helvetica',
  fontStyle: 'normal' | 'bold',
  fontSize: number,
  width: number,
) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  doc.setFont(fontName, fontStyle)
  doc.setFontSize(fontSize)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (doc.getTextWidth(trial) <= width) {
      current = trial
      continue
    }
    if (current) lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}

function fitText(
  doc: jsPDF,
  text: string,
  fontName: 'helvetica',
  fontStyle: 'normal' | 'bold',
  fontSize: number,
  maxWidth: number,
) {
  const clean = (text || '').trim().replace(/\s+/g, ' ')
  doc.setFont(fontName, fontStyle)
  doc.setFontSize(fontSize)
  if (doc.getTextWidth(clean) <= maxWidth) return clean
  let shortened = clean
  while (shortened && doc.getTextWidth(`${shortened}…`) > maxWidth) {
    shortened = shortened.slice(0, -1).trimEnd()
  }
  return shortened ? `${shortened}…` : clean
}

function drawSeparator(context: PdfContext, margin: number, width: number, y: number) {
  setStroke(context.doc, '#E2ECE9', 1)
  drawLine(context, margin, y, width - margin, y)
}

function ensurePage(context: PdfContext, y: number) {
  if (y < context.margin + 60) {
    finishPage(context)
    context.doc.addPage()
    return context.height - context.margin
  }
  return y
}

function ensureSpace(context: PdfContext, y: number, neededHeight: number) {
  if (y - neededHeight < context.margin + 60) {
    finishPage(context)
    context.doc.addPage()
    return context.height - context.margin
  }
  return y
}

function finishPage(context: PdfContext) {
  drawBrandFooter(context)
}

function drawBrandFooter(context: PdfContext) {
  const { doc, width, footerIconDataUrl } = context
  const footerY = 18
  const centerX = width / 2
  const labelText = 'HourMint'
  const metaText = 'A product of Provolone Digital'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const labelWidth = doc.getTextWidth(labelText)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  const metaWidth = doc.getTextWidth(metaText)
  const totalWidth = 14 + labelWidth + 8 + metaWidth
  const startX = centerX - totalWidth / 2

  if (footerIconDataUrl) {
    addImageAtBottomLeft(context, footerIconDataUrl, startX, footerY - 1, 13, 13)
  }

  setFont(doc, 'bold', 8.5, '#5D6C84')
  drawText(context, labelText, startX + 16, footerY + 8)

  setFont(doc, 'normal', 7.5, '#8A98AD')
  drawText(context, metaText, startX + 16 + labelWidth + 8, footerY + 8)
}

function toJsPdfY(_context: PdfContext, y: number) {
  return _context.height - y
}

function toJsPdfTop(_context: PdfContext, bottomY: number, height: number) {
  return _context.height - bottomY - height
}

function setFont(doc: jsPDF, style: 'normal' | 'bold', size: number, color: string) {
  doc.setFont('helvetica', style)
  doc.setFontSize(size)
  doc.setTextColor(color)
}

function setStroke(doc: jsPDF, color: string, width: number) {
  doc.setDrawColor(color)
  doc.setLineWidth(width)
}

function drawText(
  context: PdfContext,
  text: string,
  x: number,
  y: number,
  options?: { align?: 'left' | 'center' | 'right' },
) {
  context.doc.text(text, x, toJsPdfY(context, y), options)
}

function drawLine(context: PdfContext, x1: number, y1: number, x2: number, y2: number) {
  context.doc.line(x1, toJsPdfY(context, y1), x2, toJsPdfY(context, y2))
}

function fillRoundedRect(context: PdfContext, x: number, y: number, width: number, height: number, radius: number, color: string) {
  context.doc.setFillColor(color)
  context.doc.roundedRect(x, toJsPdfTop(context, y, height), width, height, radius, radius, 'F')
}

function addImageAtBottomLeft(
  context: PdfContext,
  dataUrl: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.doc.addImage(dataUrl, imageFormat(dataUrl), x, toJsPdfTop(context, y, height), width, height)
}

function imageFormat(dataUrl: string) {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG'
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP'
  return 'PNG'
}

function fitLogo(dataUrl: string, maxWidth: number, maxHeight: number) {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/)
  if (!match) return { width: maxWidth, height: maxHeight }
  try {
    const binary = atob(match[1])
    const pngSignature = '\x89PNG\r\n\x1a\n'
    if (!binary.startsWith(pngSignature)) return { width: maxWidth, height: maxHeight }
    const width = readUint32(binary, 16)
    const height = readUint32(binary, 20)
    const aspectRatio = width / Math.max(1, height)
    let finalWidth = maxWidth
    let finalHeight = finalWidth / Math.max(aspectRatio, 0.01)
    if (finalHeight > maxHeight) {
      finalHeight = maxHeight
      finalWidth = finalHeight * aspectRatio
    }
    return { width: finalWidth, height: finalHeight }
  } catch {
    return { width: maxWidth, height: maxHeight }
  }
}

function readUint32(binary: string, offset: number) {
  return (
    (binary.charCodeAt(offset) << 24) |
    (binary.charCodeAt(offset + 1) << 16) |
    (binary.charCodeAt(offset + 2) << 8) |
    binary.charCodeAt(offset + 3)
  ) >>> 0
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatHours(value: number) {
  return Number(value.toFixed(2)).toString()
}

function detailLabel(value: DetailLevel) {
  if (value === 'project') return 'By Project'
  if (value === 'detailed') return 'Detailed Line Items'
  return 'Summary'
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).replace(',', ',')
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace(',', ',')
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
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

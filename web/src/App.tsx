import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClock, CheckCircle2, CircleDollarSign, ClipboardList, FileText, LayoutDashboard, LoaderCircle, LogOut, Receipt, Save, Settings, Timer, Users, BriefcaseBusiness, Upload, Trash2, PencilLine, ShieldCheck, Smartphone } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'

import { createInvoicePdfBundle } from './lib/invoices'
import { supabase, supabaseUrlMissing } from './lib/supabase'
import type { ClientRecord, DetailLevel, InvoiceRecord, ProjectRecord, SettingRecord, TimeEntryRecord } from './lib/types'

type SectionKey = 'dashboard' | 'clients' | 'projects' | 'time' | 'invoices' | 'settings'
type AuthMode = 'sign-in' | 'sign-up'
type InvoiceStatus = 'paid' | 'unpaid'

type AppData = {
  clients: ClientRecord[]
  projects: ProjectRecord[]
  timeEntries: TimeEntryRecord[]
  invoices: InvoiceRecord[]
  settings: SettingRecord[]
}

type ClientFormState = {
  id: number | null
  name: string
  email: string
  company: string
  notes: string
}

type ProjectFormState = {
  id: number | null
  client_id: string
  name: string
  rate: string
  description: string
  active: boolean
}

type TimeEntryFormState = {
  id: number | null
  project_id: string
  start_at: string
  end_at: string
  description: string
}

type SettingsFormState = {
  business_name: string
  invoice_prefix: string
  default_detail_level: DetailLevel
  company_logo_path: string
}

const detailOptions: Array<{ label: string; value: DetailLevel }> = [
  { label: 'Summary', value: 'summary' },
  { label: 'By Project', value: 'project' },
  { label: 'Detailed Line Items', value: 'detailed' },
]

const sections: Array<{ key: SectionKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { key: 'time', label: 'Time', icon: Timer },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  { key: 'settings', label: 'Settings', icon: Settings },
]

const emptyData: AppData = {
  clients: [],
  projects: [],
  timeEntries: [],
  invoices: [],
  settings: [],
}

const emptyClientForm: ClientFormState = {
  id: null,
  name: '',
  email: '',
  company: '',
  notes: '',
}

const emptyProjectForm: ProjectFormState = {
  id: null,
  client_id: '',
  name: '',
  rate: '75',
  description: '',
  active: true,
}

const emptyTimeEntryForm = (): TimeEntryFormState => ({
  id: null,
  project_id: '',
  start_at: toInputDateTime(new Date()),
  end_at: toInputDateTime(new Date(Date.now() + 60 * 60 * 1000)),
  description: '',
})

const getSetting = (settings: SettingRecord[], key: string, fallback = '') =>
  settings.find((setting) => setting.key === key)?.value ?? fallback

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [loadingApp, setLoadingApp] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Connecting to HourMint...')
  const [activeSection, setActiveSection] = useState<SectionKey>('dashboard')
  const [data, setData] = useState<AppData>(emptyData)
  const [clientForm, setClientForm] = useState<ClientFormState>(emptyClientForm)
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm)
  const [timeEntryForm, setTimeEntryForm] = useState<TimeEntryFormState>(emptyTimeEntryForm())
  const [invoiceClientId, setInvoiceClientId] = useState<string>('')
  const [invoiceDetailLevel, setInvoiceDetailLevel] = useState<DetailLevel>('project')
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([])
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    business_name: 'HourMint',
    invoice_prefix: 'HM',
    default_detail_level: 'project',
    company_logo_path: '',
  })

  useEffect(() => {
    let mounted = true

    const initialize = async () => {
      if (supabaseUrlMissing) {
        setStatusMessage('Supabase environment is missing.')
        setLoadingApp(false)
        return
      }

      const [{ data: sessionData }, authListener] = await Promise.all([
        supabase.auth.getSession(),
        Promise.resolve(
          supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!mounted) return
            setSession(nextSession)
            if (nextSession) {
              void loadAppData()
            } else {
              setData(emptyData)
              setLoadingApp(false)
            }
          }),
        ),
      ])

      if (!mounted) {
        authListener.data.subscription.unsubscribe()
        return
      }

      setSession(sessionData.session)
      if (sessionData.session) {
        await loadAppData()
      } else {
        setLoadingApp(false)
      }

      return () => authListener.data.subscription.unsubscribe()
    }

    void initialize()

    return () => {
      mounted = false
    }
  }, [])

  const clientsById = useMemo(
    () => new Map(data.clients.map((client) => [client.id, client])),
    [data.clients],
  )
  const projectsById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  )

  const metrics = useMemo(() => {
    const totalBilled = data.invoices.reduce((sum, invoice) => sum + invoice.subtotal, 0)
    const totalPaid = data.invoices
      .filter((invoice) => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + invoice.subtotal, 0)
    const totalOutstanding = totalBilled - totalPaid
    const totalHours = data.timeEntries.reduce((sum, entry) => sum + entry.hours, 0)
    const uninvoicedHours = data.timeEntries
      .filter((entry) => !entry.invoiced)
      .reduce((sum, entry) => sum + entry.hours, 0)

    return {
      totalBilled,
      totalPaid,
      totalOutstanding,
      totalHours,
      uninvoicedHours,
    }
  }, [data.invoices, data.timeEntries])

  const recentInvoices = useMemo(
    () =>
      [...data.invoices]
        .sort((left, right) => right.generated_at.localeCompare(left.generated_at))
        .slice(0, 5),
    [data.invoices],
  )

  const topProjects = useMemo(() => {
    const projectTotals = new Map<number, number>()
    data.timeEntries.forEach((entry) => {
      projectTotals.set(entry.project_id, (projectTotals.get(entry.project_id) ?? 0) + entry.hours)
    })

    return [...projectTotals.entries()]
      .map(([projectId, hours]) => ({ project: projectsById.get(projectId), hours }))
      .filter((entry) => entry.project)
      .sort((left, right) => right.hours - left.hours)
      .slice(0, 5)
  }, [data.timeEntries, projectsById])

  const invoiceEntries = useMemo(() => {
    if (!invoiceClientId) return []
    const clientProjects = data.projects
      .filter((project) => project.client_id === Number(invoiceClientId))
      .map((project) => project.id)

    return data.timeEntries
      .filter((entry) => !entry.invoiced && clientProjects.includes(entry.project_id))
      .sort((left, right) => left.start_at.localeCompare(right.start_at))
  }, [data.projects, data.timeEntries, invoiceClientId])

  const logoUrl = useMemo(() => {
    if (!settingsForm.company_logo_path) return ''
    return supabase.storage.from('branding').getPublicUrl(settingsForm.company_logo_path).data.publicUrl
  }, [settingsForm.company_logo_path])

  useEffect(() => {
    if (!invoiceClientId && data.clients.length) {
      setInvoiceClientId(String(data.clients[0].id))
    }
  }, [data.clients, invoiceClientId])

  useEffect(() => {
    if (!selectedEntryIds.length && invoiceEntries.length) {
      setSelectedEntryIds(invoiceEntries.map((entry) => entry.id))
    } else {
      setSelectedEntryIds((current) =>
        current.filter((entryId) => invoiceEntries.some((entry) => entry.id === entryId)),
      )
    }
  }, [invoiceEntries, selectedEntryIds.length])

  async function loadAppData() {
    setLoadingApp(true)
    setStatusMessage('Loading your web workspace...')

    const [clientsRes, projectsRes, timeEntriesRes, invoicesRes, settingsRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('*').order('name'),
      supabase.from('time_entries').select('*').order('start_at', { ascending: false }),
      supabase.from('invoices').select('*').order('generated_at', { ascending: false }),
      supabase.from('settings').select('*').order('key'),
    ])

    const firstError =
      clientsRes.error ||
      projectsRes.error ||
      timeEntriesRes.error ||
      invoicesRes.error ||
      settingsRes.error

    if (firstError) {
      setStatusMessage(firstError.message)
      setLoadingApp(false)
      return
    }

    const nextData: AppData = {
      clients: clientsRes.data ?? [],
      projects: projectsRes.data ?? [],
      timeEntries: timeEntriesRes.data ?? [],
      invoices: invoicesRes.data ?? [],
      settings: settingsRes.data ?? [],
    }

    setData(nextData)
    const nextSettings = {
      business_name: getSetting(nextData.settings, 'business_name', 'HourMint'),
      invoice_prefix: getSetting(nextData.settings, 'invoice_prefix', 'HM'),
      default_detail_level: (getSetting(nextData.settings, 'default_detail_level', 'project') as DetailLevel) || 'project',
      company_logo_path: getSetting(nextData.settings, 'company_logo_path'),
    }
    setSettingsForm(nextSettings)
    setInvoiceDetailLevel(nextSettings.default_detail_level)
    setStatusMessage('Everything is synced.')
    setLoadingApp(false)
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthMessage('')

    const response =
      authMode === 'sign-in'
        ? await supabase.auth.signInWithPassword({
            email: authEmail.trim(),
            password: authPassword,
          })
        : await supabase.auth.signUp({
            email: authEmail.trim(),
            password: authPassword,
          })

    setAuthBusy(false)

    if (response.error) {
      setAuthMessage(response.error.message)
      return
    }

    setAuthMessage(
      authMode === 'sign-up'
        ? 'Account created. If email confirmation is enabled, confirm it and sign in.'
        : 'Welcome back.',
    )
  }

  async function saveClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!clientForm.name.trim()) return

    await withSaving(async () => {
      const payload = {
        name: clientForm.name.trim(),
        email: clientForm.email.trim() || null,
        company: clientForm.company.trim() || null,
        notes: clientForm.notes.trim() || null,
      }

      const query = clientForm.id
        ? supabase.from('clients').update(payload).eq('id', clientForm.id)
        : supabase.from('clients').insert([{ ...payload }])

      const { error } = await query
      if (error) throw error

      setClientForm(emptyClientForm)
      setStatusMessage(clientForm.id ? 'Client updated.' : 'Client created.')
      await loadAppData()
    })
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!projectForm.client_id || !projectForm.name.trim() || !projectForm.rate) return

    await withSaving(async () => {
      const payload = {
        client_id: Number(projectForm.client_id),
        name: projectForm.name.trim(),
        rate: Number(projectForm.rate),
        description: projectForm.description.trim() || null,
        active: projectForm.active,
      }

      const query = projectForm.id
        ? supabase.from('projects').update(payload).eq('id', projectForm.id)
        : supabase.from('projects').insert([{ ...payload }])

      const { error } = await query
      if (error) throw error

      setProjectForm(emptyProjectForm)
      setStatusMessage(projectForm.id ? 'Project updated.' : 'Project created.')
      await loadAppData()
    })
  }

  async function saveTimeEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!timeEntryForm.project_id || !timeEntryForm.description.trim()) return

    const startAt = new Date(timeEntryForm.start_at)
    const endAt = new Date(timeEntryForm.end_at)

    if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || endAt <= startAt) {
      setStatusMessage('Pick a valid start and end time.')
      return
    }

    const overlap = data.timeEntries.find((entry) => {
      if (timeEntryForm.id && entry.id === timeEntryForm.id) return false
      return new Date(entry.start_at) < endAt && new Date(entry.end_at) > startAt
    })

    if (overlap) {
      setStatusMessage(
        `This overlaps with ${projectsById.get(overlap.project_id)?.name ?? 'another entry'} (${formatReadableDateTime(overlap.start_at)} to ${formatReadableDateTime(overlap.end_at)}).`,
      )
      return
    }

    const hours = Number(((endAt.valueOf() - startAt.valueOf()) / 3_600_000).toFixed(2))

    await withSaving(async () => {
      const payload = {
        project_id: Number(timeEntryForm.project_id),
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        hours,
        description: timeEntryForm.description.trim(),
      }

      const query = timeEntryForm.id
        ? supabase
            .from('time_entries')
            .update(payload)
            .eq('id', timeEntryForm.id)
            .eq('invoiced', false)
        : supabase.from('time_entries').insert([{ ...payload }])

      const { error } = await query
      if (error) throw error

      setTimeEntryForm(emptyTimeEntryForm())
      setStatusMessage(timeEntryForm.id ? 'Time entry updated.' : 'Time entry created.')
      await loadAppData()
    })
  }

  async function deleteRow(table: 'clients' | 'projects' | 'time_entries' | 'invoices', id: number) {
    await withSaving(async () => {
      if (table === 'invoices') {
        const invoice = data.invoices.find((item) => item.id === id)
        if (!invoice) return

        const { error: restoreError } = await supabase
          .from('time_entries')
          .update({ invoiced: false, invoice_id: null })
          .eq('invoice_id', id)
        if (restoreError) throw restoreError

        const { error: deleteError } = await supabase.from('invoices').delete().eq('id', id)
        if (deleteError) throw deleteError

        await Promise.all(
          [invoice.pdf_path, invoice.summary_pdf_path, invoice.project_pdf_path, invoice.detailed_pdf_path]
            .filter(Boolean)
            .map((path) => supabase.storage.from('invoices').remove([path as string])),
        )
      } else {
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw error
      }

      setStatusMessage('Record removed.')
      await loadAppData()
    })
  }

  async function setInvoiceStatus(invoiceId: number, status: InvoiceStatus) {
    await withSaving(async () => {
      const { error } = await supabase
        .from('invoices')
        .update({
          status,
          paid_at: status === 'paid' ? new Date().toISOString() : null,
        })
        .eq('id', invoiceId)

      if (error) throw error
      setStatusMessage(`Invoice marked ${status}.`)
      await loadAppData()
    })
  }

  async function handleLogoUpload(file: File) {
    await withSaving(async () => {
      const extension = file.name.split('.').pop() || 'png'
      const path = `logos/company-logo.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('branding')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/png' })

      if (uploadError) throw uploadError

      const { error: settingError } = await supabase
        .from('settings')
        .upsert([{ key: 'company_logo_path', value: path }], { onConflict: 'key' })

      if (settingError) throw settingError

      setSettingsForm((current) => ({ ...current, company_logo_path: path }))
      setStatusMessage('Logo updated.')
      await loadAppData()
    })
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    await withSaving(async () => {
      const rows = [
        { key: 'business_name', value: settingsForm.business_name.trim() || 'HourMint' },
        { key: 'invoice_prefix', value: settingsForm.invoice_prefix.trim().toUpperCase() || 'HM' },
        { key: 'default_detail_level', value: settingsForm.default_detail_level },
        { key: 'company_logo_path', value: settingsForm.company_logo_path || '' },
      ]

      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
      if (error) throw error

      setStatusMessage('Workspace settings saved.')
      await loadAppData()
    })
  }

  async function generateInvoice() {
    if (!invoiceClientId || !selectedEntryIds.length) {
      setStatusMessage('Choose a client and at least one uninvoiced time entry.')
      return
    }

    const client = clientsById.get(Number(invoiceClientId))
    if (!client) return

    const selectedEntries = invoiceEntries.filter((entry) => selectedEntryIds.includes(entry.id))
    if (!selectedEntries.length) return

    const invoiceNumber = `${settingsForm.invoice_prefix || 'HM'}-${format(new Date(), 'yyyyMMdd')}-${String(data.invoices.length + 1).padStart(3, '0')}`
    const subtotal = selectedEntries.reduce((sum, entry) => {
      const project = projectsById.get(entry.project_id)
      return sum + entry.hours * Number(project?.rate ?? 0)
    }, 0)

    await withSaving(async () => {
      const bundle = await createInvoicePdfBundle({
        invoiceNumber,
        client,
        entries: selectedEntries,
        businessName: settingsForm.business_name || 'HourMint',
        detailLevel: invoiceDetailLevel,
        logoUrl,
        projectsById,
      })

      const uploads = await Promise.all(
        Object.entries(bundle).map(async ([detail, blob]) => {
          const path = `${invoiceNumber}-${detail}.pdf`
          const { error } = await supabase.storage.from('invoices').upload(path, blob, {
            upsert: true,
            contentType: 'application/pdf',
          })
          if (error) throw error
          return [detail, path] as const
        }),
      )

      const paths = Object.fromEntries(uploads) as Record<DetailLevel, string>

      const { data: createdInvoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert([
          {
            invoice_number: invoiceNumber,
            client_id: client.id,
            generated_at: new Date().toISOString(),
            detail_level: invoiceDetailLevel,
            subtotal: Number(subtotal.toFixed(2)),
            status: 'unpaid',
            paid_at: null,
            pdf_path: paths[invoiceDetailLevel],
            summary_pdf_path: paths.summary,
            project_pdf_path: paths.project,
            detailed_pdf_path: paths.detailed,
          },
        ])
        .select()
        .single()

      if (invoiceError) throw invoiceError

      const { error: updateError } = await supabase
        .from('time_entries')
        .update({ invoiced: true, invoice_id: createdInvoice.id })
        .in('id', selectedEntryIds)

      if (updateError) throw updateError

      setSelectedEntryIds([])
      setStatusMessage(`Invoice ${invoiceNumber} generated.`)
      await loadAppData()
    })
  }

  async function downloadInvoice(invoice: InvoiceRecord, detailLevel: DetailLevel) {
    const path =
      detailLevel === 'summary'
        ? invoice.summary_pdf_path
        : detailLevel === 'project'
          ? invoice.project_pdf_path
          : invoice.detailed_pdf_path

    if (!path) return
    const { data: signed, error } = await supabase.storage.from('invoices').createSignedUrl(path, 120)
    if (error || !signed?.signedUrl) {
      setStatusMessage(error?.message || 'Could not create a download link.')
      return
    }
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setLoadingApp(false)
  }

  async function withSaving(work: () => Promise<void>) {
    setSaving(true)
    try {
      await work()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (supabaseUrlMissing) {
    return (
      <div className="shell shell--centered">
        <div className="message-card">
          <h1>HourMint needs its Supabase keys</h1>
          <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your web app environment and reload.</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="shell shell--centered">
        <div className="auth-panel">
          <div className="auth-copy">
            <span className="eyebrow">HourMint Web</span>
            <h1>Track hours anywhere.</h1>
            <p>Desktop data, invoice history, and branding now live in one mobile-friendly workspace backed by Supabase.</p>
            <div className="feature-grid">
              <FeaturePill icon={ShieldCheck} text="Secure Supabase login" />
              <FeaturePill icon={Smartphone} text="Built for phone and desktop" />
              <FeaturePill icon={FileText} text="Invoice PDFs stay synced" />
            </div>
          </div>

          <form className="auth-card" onSubmit={handleAuthSubmit}>
            <div className="auth-card__header">
              <h2>{authMode === 'sign-in' ? 'Welcome back' : 'Create your access'}</h2>
              <p>Trusted devices keep a long-running session ID so you do not have to babysit logins.</p>
            </div>

            <label className="field">
              <span>Email</span>
              <input
                autoComplete="email"
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@hourmint.co"
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="Minimum 6 characters"
                required
              />
            </label>

            <button className="button button--primary" type="submit" disabled={authBusy}>
              {authBusy ? 'Working...' : authMode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>

            {authMessage ? <p className="status-text">{authMessage}</p> : null}

            <button
              className="button button--ghost"
              type="button"
              onClick={() => setAuthMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))}
            >
              {authMode === 'sign-in' ? 'Need an account?' : 'Already have an account?'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (loadingApp) {
    return (
      <div className="shell shell--centered">
        <div className="message-card">
          <LoaderCircle className="spinner" />
          <h1>Loading HourMint</h1>
          <p>{statusMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-mark">HM</div>
          <div>
            <p className="eyebrow">HourMint</p>
            <h1>{settingsForm.business_name || 'HourMint'}</h1>
          </div>
        </div>

        <nav className="nav">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.key}
                className={`nav__item ${activeSection === section.key ? 'nav__item--active' : ''}`}
                type="button"
                onClick={() => setActiveSection(section.key)}
              >
                <Icon size={18} />
                <span>{section.label}</span>
              </button>
            )
          })}
        </nav>

        <button className="button button--ghost button--sidebar" type="button" onClick={() => void signOut()}>
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Synced workspace</p>
            <h2>{sections.find((section) => section.key === activeSection)?.label}</h2>
          </div>
          <div className="workspace-header__meta">
            <span>{statusMessage}</span>
            {saving ? <LoaderCircle className="spinner spinner--small" /> : <CheckCircle2 size={16} />}
          </div>
        </header>

        {activeSection === 'dashboard' ? (
          <section className="section-stack">
            <div className="hero-card">
              <div>
                <span className="eyebrow">Live pulse</span>
                <h3>One clean web home for hours, invoices, and client work.</h3>
                <p>
                  Your existing data is now structured for mobile and desktop use, with invoice files and branding ready to travel with you.
                </p>
              </div>
              {logoUrl ? (
                <div className="hero-card__brand">
                  <span className="hero-card__brand-label">Brand system</span>
                  <img className="hero-card__logo" src={logoUrl} alt="Company logo" />
                </div>
              ) : null}
            </div>

            <div className="stats-grid">
              <StatCard label="Total billed" value={formatCurrency(metrics.totalBilled)} icon={CircleDollarSign} />
              <StatCard label="Paid" value={formatCurrency(metrics.totalPaid)} icon={CheckCircle2} />
              <StatCard label="Outstanding" value={formatCurrency(metrics.totalOutstanding)} icon={Receipt} />
              <StatCard label="Tracked hours" value={formatHours(metrics.totalHours)} icon={CalendarClock} />
              <StatCard label="Uninvoiced hours" value={formatHours(metrics.uninvoicedHours)} icon={FileText} />
            </div>

            <div className="panel-grid">
              <article className="panel">
                <div className="panel__header">
                  <h3>Recent invoices</h3>
                  <ClipboardList size={18} />
                </div>
                <div className="list">
                  {recentInvoices.map((invoice) => (
                    <div className="list-row" key={invoice.id}>
                      <div>
                        <strong>{invoice.invoice_number}</strong>
                        <p>{clientsById.get(invoice.client_id)?.name ?? 'Unknown client'}</p>
                      </div>
                      <div className="list-row__meta">
                        <span className={`badge ${invoice.status === 'paid' ? 'badge--paid' : 'badge--open'}`}>{invoice.status}</span>
                        <strong>{formatCurrency(invoice.subtotal)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel__header">
                  <h3>Top projects by hours</h3>
                  <Timer size={18} />
                </div>
                <div className="list">
                  {topProjects.map(({ project, hours }) => (
                    <div className="list-row" key={project?.id}>
                      <div>
                        <strong>{project?.name}</strong>
                        <p>{clientsById.get(project?.client_id ?? 0)?.name ?? 'Unknown client'}</p>
                      </div>
                      <strong>{formatHours(hours)}</strong>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === 'clients' ? (
          <section className="section-stack">
            <div className="panel panel--form">
              <div className="panel__header">
                <h3>{clientForm.id ? 'Edit client' : 'Add client'}</h3>
                <Users size={18} />
              </div>
              <form className="form-grid" onSubmit={saveClient}>
                <label className="field">
                  <span>Name</span>
                  <input
                    value={clientForm.name}
                    onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={clientForm.email}
                    onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Company</span>
                  <input
                    value={clientForm.company}
                    onChange={(event) => setClientForm((current) => ({ ...current, company: event.target.value }))}
                  />
                </label>
                <label className="field field--wide">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    value={clientForm.notes}
                    onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
                <div className="button-row">
                  <button className="button button--primary" type="submit">
                    <Save size={16} />
                    <span>{clientForm.id ? 'Update client' : 'Save client'}</span>
                  </button>
                  {clientForm.id ? (
                    <button className="button button--ghost" type="button" onClick={() => setClientForm(emptyClientForm)}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="cards-grid">
              {data.clients.map((client) => (
                <article className="record-card" key={client.id}>
                  <div className="record-card__header">
                    <div>
                      <h4>{client.name}</h4>
                      <p>{client.company || 'Independent client'}</p>
                    </div>
                    <span className="badge badge--muted">{client.email || 'No email'}</span>
                  </div>
                  <p>{client.notes || 'No notes saved yet.'}</p>
                  <div className="button-row">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() =>
                        setClientForm({
                          id: client.id,
                          name: client.name,
                          email: client.email ?? '',
                          company: client.company ?? '',
                          notes: client.notes ?? '',
                        })
                      }
                    >
                      <PencilLine size={16} />
                      <span>Edit</span>
                    </button>
                    <button className="button button--danger" type="button" onClick={() => void deleteRow('clients', client.id)}>
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === 'projects' ? (
          <section className="section-stack">
            <div className="panel panel--form">
              <div className="panel__header">
                <h3>{projectForm.id ? 'Edit project' : 'Add project'}</h3>
                <BriefcaseBusiness size={18} />
              </div>
              <form className="form-grid" onSubmit={saveProject}>
                <label className="field">
                  <span>Client</span>
                  <select
                    value={projectForm.client_id}
                    onChange={(event) => setProjectForm((current) => ({ ...current, client_id: event.target.value }))}
                    required
                  >
                    <option value="">Select a client</option>
                    {data.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Project name</span>
                  <input
                    value={projectForm.name}
                    onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>Hourly rate</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={projectForm.rate}
                    onChange={(event) => setProjectForm((current) => ({ ...current, rate: event.target.value }))}
                    required
                  />
                </label>
                <label className="field field--wide">
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={projectForm.description}
                    onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <label className="toggle">
                  <input
                    checked={projectForm.active}
                    onChange={(event) => setProjectForm((current) => ({ ...current, active: event.target.checked }))}
                    type="checkbox"
                  />
                  <span>Active project</span>
                </label>
                <div className="button-row">
                  <button className="button button--primary" type="submit">
                    <Save size={16} />
                    <span>{projectForm.id ? 'Update project' : 'Save project'}</span>
                  </button>
                  {projectForm.id ? (
                    <button className="button button--ghost" type="button" onClick={() => setProjectForm(emptyProjectForm)}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="cards-grid">
              {data.projects.map((project) => (
                <article className="record-card" key={project.id}>
                  <div className="record-card__header">
                    <div>
                      <h4>{project.name}</h4>
                      <p>{clientsById.get(project.client_id)?.name ?? 'Unknown client'}</p>
                    </div>
                    <span className="badge badge--money">{formatCurrency(Number(project.rate))}/hr</span>
                  </div>
                  <p>{project.description || 'No project description yet.'}</p>
                  <div className="button-row">
                    <button className="button button--ghost" type="button" onClick={() => setProjectForm({
                      id: project.id,
                      client_id: String(project.client_id),
                      name: project.name,
                      rate: String(project.rate),
                      description: project.description ?? '',
                      active: project.active,
                    })}>
                      <PencilLine size={16} />
                      <span>Edit</span>
                    </button>
                    <button className="button button--danger" type="button" onClick={() => void deleteRow('projects', project.id)}>
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === 'time' ? (
          <section className="section-stack">
            <div className="panel panel--form">
              <div className="panel__header">
                <h3>{timeEntryForm.id ? 'Edit time entry' : 'Track time'}</h3>
                <CalendarClock size={18} />
              </div>
              <form className="form-grid" onSubmit={saveTimeEntry}>
                <label className="field">
                  <span>Project</span>
                  <select
                    value={timeEntryForm.project_id}
                    onChange={(event) => setTimeEntryForm((current) => ({ ...current, project_id: event.target.value }))}
                    required
                  >
                    <option value="">Select a project</option>
                    {data.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Start</span>
                  <input
                    type="datetime-local"
                    value={timeEntryForm.start_at}
                    onChange={(event) => setTimeEntryForm((current) => ({ ...current, start_at: event.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>End</span>
                  <input
                    type="datetime-local"
                    value={timeEntryForm.end_at}
                    onChange={(event) => setTimeEntryForm((current) => ({ ...current, end_at: event.target.value }))}
                    required
                  />
                </label>
                <label className="field field--wide">
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={timeEntryForm.description}
                    onChange={(event) => setTimeEntryForm((current) => ({ ...current, description: event.target.value }))}
                    required
                  />
                </label>
                <div className="button-row">
                  <button className="button button--primary" type="submit">
                    <Save size={16} />
                    <span>{timeEntryForm.id ? 'Update time' : 'Save time'}</span>
                  </button>
                  {timeEntryForm.id ? (
                    <button className="button button--ghost" type="button" onClick={() => setTimeEntryForm(emptyTimeEntryForm())}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="list panel">
              {data.timeEntries.map((entry) => {
                const project = projectsById.get(entry.project_id)
                return (
                  <article className="list-row list-row--stacked" key={entry.id}>
                    <div>
                      <div className="list-row__title">
                        <strong>{project?.name ?? 'Unknown project'}</strong>
                        <span className={`badge ${entry.invoiced ? 'badge--paid' : 'badge--open'}`}>{entry.invoiced ? 'invoiced' : 'open'}</span>
                      </div>
                      <p>{entry.description}</p>
                      <small>
                        {formatReadableDateTime(entry.start_at)} to {formatReadableDateTime(entry.end_at)}
                      </small>
                    </div>
                    <div className="list-row__meta list-row__meta--actions">
                      <strong>{formatHours(entry.hours)} hrs</strong>
                      <div className="button-row">
                        <button
                          className="button button--ghost"
                          disabled={entry.invoiced}
                          type="button"
                          onClick={() =>
                            setTimeEntryForm({
                              id: entry.id,
                              project_id: String(entry.project_id),
                              start_at: toInputDateTime(new Date(entry.start_at)),
                              end_at: toInputDateTime(new Date(entry.end_at)),
                              description: entry.description,
                            })
                          }
                        >
                          <PencilLine size={16} />
                          <span>Edit</span>
                        </button>
                        <button
                          className="button button--danger"
                          disabled={entry.invoiced}
                          type="button"
                          onClick={() => void deleteRow('time_entries', entry.id)}
                        >
                          <Trash2 size={16} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        {activeSection === 'invoices' ? (
          <section className="section-stack">
            <div className="panel panel--form">
              <div className="panel__header">
                <h3>Generate invoice</h3>
                <Receipt size={18} />
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Client</span>
                  <select value={invoiceClientId} onChange={(event) => setInvoiceClientId(event.target.value)}>
                    {data.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Detail level</span>
                  <select
                    value={invoiceDetailLevel}
                    onChange={(event) => setInvoiceDetailLevel(event.target.value as DetailLevel)}
                  >
                    {detailOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="selection-toolbar">
                <button className="button button--ghost" type="button" onClick={() => setSelectedEntryIds(invoiceEntries.map((entry) => entry.id))}>
                  Select all
                </button>
                <button className="button button--ghost" type="button" onClick={() => setSelectedEntryIds([])}>
                  Clear
                </button>
                <button className="button button--primary" type="button" onClick={() => void generateInvoice()}>
                  <FileText size={16} />
                  <span>Generate invoice PDFs</span>
                </button>
              </div>

              <div className="selection-list">
                {invoiceEntries.map((entry) => {
                  const checked = selectedEntryIds.includes(entry.id)
                  const project = projectsById.get(entry.project_id)
                  return (
                    <label className={`selection-card ${checked ? 'selection-card--active' : ''}`} key={entry.id}>
                      <input
                        checked={checked}
                        onChange={(event) =>
                          setSelectedEntryIds((current) =>
                            event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id),
                          )
                        }
                        type="checkbox"
                      />
                      <div>
                        <strong>{project?.name ?? 'Unknown project'}</strong>
                        <p>{entry.description}</p>
                        <small>
                          {formatReadableDateTime(entry.start_at)} • {formatHours(entry.hours)} hrs
                        </small>
                      </div>
                    </label>
                  )
                })}
                {!invoiceEntries.length ? <p className="empty-state">No uninvoiced time entries are waiting for this client.</p> : null}
              </div>
            </div>

            <div className="list panel">
              {data.invoices.map((invoice) => (
                <article className="list-row list-row--stacked" key={invoice.id}>
                  <div>
                    <div className="list-row__title">
                      <strong>{invoice.invoice_number}</strong>
                      <span className={`badge ${invoice.status === 'paid' ? 'badge--paid' : 'badge--open'}`}>{invoice.status}</span>
                    </div>
                    <p>{clientsById.get(invoice.client_id)?.name ?? 'Unknown client'}</p>
                    <small>
                      {formatReadableDateTime(invoice.generated_at)} • {formatCurrency(invoice.subtotal)}
                    </small>
                  </div>
                  <div className="list-row__meta list-row__meta--actions">
                    <div className="button-row">
                      <button className="button button--ghost" type="button" onClick={() => void downloadInvoice(invoice, 'summary')}>
                        Summary
                      </button>
                      <button className="button button--ghost" type="button" onClick={() => void downloadInvoice(invoice, 'project')}>
                        Project
                      </button>
                      <button className="button button--ghost" type="button" onClick={() => void downloadInvoice(invoice, 'detailed')}>
                        Detailed
                      </button>
                    </div>
                    <div className="button-row">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => void setInvoiceStatus(invoice.id, invoice.status === 'paid' ? 'unpaid' : 'paid')}
                      >
                        {invoice.status === 'paid' ? 'Mark unpaid' : 'Mark paid'}
                      </button>
                      <button className="button button--danger" type="button" onClick={() => void deleteRow('invoices', invoice.id)}>
                        <Trash2 size={16} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === 'settings' ? (
          <section className="section-stack">
            <div className="panel panel--form">
              <div className="panel__header">
                <h3>Workspace settings</h3>
                <Settings size={18} />
              </div>
              <form className="form-grid" onSubmit={saveSettings}>
                <label className="field">
                  <span>Business name</span>
                  <input
                    value={settingsForm.business_name}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, business_name: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Invoice prefix</span>
                  <input
                    maxLength={6}
                    value={settingsForm.invoice_prefix}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, invoice_prefix: event.target.value.toUpperCase() }))}
                  />
                </label>
                <label className="field">
                  <span>Default detail level</span>
                  <select
                    value={settingsForm.default_detail_level}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        default_detail_level: event.target.value as DetailLevel,
                      }))
                    }
                  >
                    {detailOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field--wide">
                  <span>Brand logo</span>
                  <div className="upload-box">
                    {logoUrl ? <img className="logo-preview" src={logoUrl} alt="Current brand logo" /> : null}
                    <label className="button button--ghost">
                      <Upload size={16} />
                      <span>Upload logo</span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) {
                            void handleLogoUpload(file)
                          }
                        }}
                      />
                    </label>
                  </div>
                </label>
                <div className="button-row">
                  <button className="button button--primary" type="submit">
                    <Save size={16} />
                    <span>Save settings</span>
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        <nav className="mobile-nav">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.key}
                className={`mobile-nav__item ${activeSection === section.key ? 'mobile-nav__item--active' : ''}`}
                type="button"
                onClick={() => setActiveSection(section.key)}
              >
                <Icon size={18} />
                <span>{section.label}</span>
              </button>
            )
          })}
        </nav>
      </main>
    </div>
  )
}

function FeaturePill({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return (
    <div className="feature-pill">
      <Icon size={16} />
      <span>{text}</span>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof CircleDollarSign; label: string; value: string }) {
  return (
    <article className="stat-card">
      <div className="stat-card__icon">
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0)
}

function formatHours(value: number) {
  return `${value.toFixed(2)} hrs`
}

function toInputDateTime(value: Date) {
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function formatReadableDateTime(value: string) {
  return format(new Date(value), 'MMM d, yyyy h:mm a')
}

export default App

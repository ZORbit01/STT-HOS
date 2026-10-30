import { useEffect, useRef, useState, useMemo } from 'react'
import { ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useORStore } from '../../store/useORStore'
import { listRooms } from '../../api/rooms'
import { listAdminCases } from '../../api/cases'
import { apiErrorMessage } from '../../api/errors'
import { createInductionPhysician, deleteInductionPhysician, listInductionPhysicians, updateInductionPhysician } from '../../api/inductionPhysicians'
import { createDoctor, deleteDoctor, listDoctors, updateDoctor } from '../../api/doctors'
import { createNurse, deleteNurse, listNurses, updateNurse } from '../../api/nurses'
import { createCompany, deleteCompany, listCompanies, updateCompany } from '../../api/companies'
import { createHospitalRoom, deleteHospitalRoom, listHospitalRooms, updateHospitalRoom } from '../../api/hospitalRooms'
import { createSurgery, deleteSurgery, listSurgeries, updateSurgery } from '../../api/surgeries'
import { previewSchedule, uploadSchedule } from '../../api/imports'
import type { SchedulePreview } from '../../api/imports'
import type { Case, Company, HospitalRoom, InductionPhysician, NurseAccount, Surgeon, Surgery } from '../../types'
import AdminCasesPanel from './AdminCasesPanel'

// ─── Import panel ─────────────────────────────────────────────────────────────

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState<'idle' | 'reading' | 'preview' | 'uploading' | 'success' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [showWarnings, setShowWarnings] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPreview(null)
    setFile(null)
    setWarnings([])
    setShowWarnings(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // The sheets leave the date, AM/PM and durations implicit, so the file is parsed
  // and shown for checking before anything is written.
  const handleChoose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0]
    if (!chosen) return
    setStatus('reading')
    setMsg('')
    setWarnings([])
    try {
      const res = await previewSchedule(chosen)
      setPreview(res.data)
      setFile(chosen)
      setWarnings(res.data.warnings)
      setStatus('preview')
    } catch (err: unknown) {
      setStatus('error')
      setMsg(apiErrorMessage(err, 'Could not read the file'))
      reset()
    }
  }

  const handleConfirm = async () => {
    if (!file) return
    setStatus('uploading')
    try {
      const res = await uploadSchedule(file)
      setStatus('success')
      setMsg(`${res.data.cases_created} cases imported from ${res.data.filename} for ${res.data.schedule_date}`)
      setWarnings(res.data.warnings)
      reset()
      onImported()
    } catch (err: unknown) {
      setStatus('error')
      setMsg(apiErrorMessage(err, 'Import failed'))
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-4 border-b border-[#E2E8F0] pb-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Import schedule</h2>
        <p className="mt-0.5 text-xs font-semibold text-[#94A3B8]">Upload the daily OR schedule to create surgical cases. You'll see what was read before anything is saved.</p>
      </div>
      <div className="border-y border-[#E2E8F0] py-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Expected layout</div>
        <ul className="mt-1 space-y-0.5 text-xs font-semibold text-[#475569]">
          <li>· A header row containing <span className="font-mono">Procedure</span> and <span className="font-mono">Surgeon</span> — a title block above it is fine.</li>
          <li>· The room code (<span className="font-mono">R1</span>, <span className="font-mono">R2</span>…) in the first column, merged down each room's block of rows.</li>
          <li>· The schedule date in a cell above the header, e.g. <span className="font-mono">Date:5-6-2026</span> (day-month-year).</li>
          <li>· A scheduled time per row, e.g. <span className="font-mono">7.30.</span> — read on a 12-hour OR-day clock, so <span className="font-mono">1.00.</span> is 13:00.</li>
        </ul>
        <div className="mt-3 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Also read when present</div>
        <div className="mt-1 font-mono text-xs font-semibold text-[#475569]">Name, case no, DOB (year), code, Company</div>
        <div className="mt-2 text-xs font-semibold text-[#94A3B8]">Case duration isn't in the file — it's taken from the gap to the next case in the same room. Room codes R1–R6 map to OR1–OR6.</div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleChoose} className="hidden" id="schedule-file" />
        <label
          htmlFor="schedule-file"
          className={`h-9 cursor-pointer px-4 py-2 text-xs font-black uppercase tracking-wide ${
            status === 'reading' || status === 'uploading' ? 'cursor-not-allowed bg-[#E2E8F0] text-[#94A3B8]' : 'bg-[#0F2044] text-white hover:bg-[#19315F]'
          }`}
        >
          {status === 'reading' ? 'Reading…' : 'Choose Excel File'}
        </label>
        {status === 'success' && <span className="text-xs font-semibold text-[#16A34A]">{msg}</span>}
        {status === 'error' && <span className="text-xs font-semibold text-[#DC2626]">{msg}</span>}
      </div>

      {preview && (
        <div className="mt-5 border border-[#E2E8F0]">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">
              {preview.cases.length} cases · {preview.schedule_date}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="h-8 px-3 text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#E2E8F0]">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={status === 'uploading'}
                className="h-8 bg-[#0F2044] px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
              >
                {status === 'uploading' ? 'Importing…' : 'Confirm import'}
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                <tr className="border-b border-[#E2E8F0]">
                  <th className="px-2 py-1.5 text-left">Room</th>
                  <th className="px-2 py-1.5 text-left">Start</th>
                  <th className="px-2 py-1.5 text-left">Mins</th>
                  <th className="px-2 py-1.5 text-left">Procedure</th>
                  <th className="px-2 py-1.5 text-left">Surgeon</th>
                  <th className="px-2 py-1.5 text-left">Age</th>
                  <th className="px-2 py-1.5 text-left">Code</th>
                </tr>
              </thead>
              <tbody className="font-semibold text-[#475569]">
                {preview.cases.map((c) => (
                  <tr key={c.source_row} className="border-b border-[#F1F5F9]">
                    <td className="px-2 py-1.5">{c.room_code}</td>
                    <td className="px-2 py-1.5 font-mono">{c.scheduled_start.slice(11, 16)}</td>
                    <td className="px-2 py-1.5">{c.estimated_duration_min ?? '—'}</td>
                    <td className="px-2 py-1.5">{c.procedure_name}</td>
                    <td className="px-2 py-1.5">{c.doctor_name}</td>
                    <td className="px-2 py-1.5">{c.patient_age ?? '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{c.procedure_code ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 border border-[#E2E8F0]">
          <button
            onClick={() => setShowWarnings((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-black uppercase tracking-widest text-[#0F172A] hover:bg-[#F8FAFC]"
          >
            <span>{warnings.length} notes on what was read</span>
            <span className="text-[#94A3B8]">{showWarnings ? '−' : '+'}</span>
          </button>
          {showWarnings && (
            <ul className="max-h-64 space-y-0.5 overflow-auto border-t border-[#E2E8F0] px-3 py-2 font-mono text-[11px] font-semibold text-[#475569]">
              {warnings.map((w, i) => (
                <li key={i} className={w.includes('Skipped') || w.includes('not configured') ? 'text-[#B45309]' : ''}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

type Tab = 'cases' | 'physicians'
type PhysicianSubTab = 'induction' | 'surgeons' | 'surgeries' | 'nurses' | 'companies' | 'hospital_rooms' | 'import'
const MANAGEMENT_PAGE_SIZE = 8

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Refresh"
      title="Refresh"
      className="flex h-8 w-8 items-center justify-center border border-[#CBD5E1] text-[#475569] hover:bg-[#F8FAFC]"
    >
      <ArrowPathIcon className="h-4 w-4" />
    </button>
  )
}

function ManagementToolbar({ query, onQueryChange, onRefresh, placeholder }: {
  query: string
  onQueryChange: (value: string) => void
  onRefresh: () => void
  placeholder: string
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative block">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 w-48 border border-[#CBD5E1] bg-white pl-8 pr-3 text-xs font-semibold text-[#0F172A] outline-none focus:border-[#0F2044]"
        />
      </label>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}

function ManagementPagination({ page, totalItems, onPageChange }: {
  page: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  if (totalItems === 0) return null
  const totalPages = Math.max(1, Math.ceil(totalItems / MANAGEMENT_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * MANAGEMENT_PAGE_SIZE + 1
  const end = Math.min(currentPage * MANAGEMENT_PAGE_SIZE, totalItems)

  return (
    <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
        {start}–{end} of {totalItems}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center border border-[#CBD5E1] text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="min-w-16 text-center text-xs font-black text-[#0F172A]">{currentPage} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center border border-[#CBD5E1] text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Physician row with 3-dot menu ───────────────────────────────────────────

function PhysicianRow({ physician, onToggle, onRemove }: {
  physician: InductionPhysician
  onToggle: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-black text-[#0F172A]">Dr. {physician.first_name} {physician.last_name}</div>
        <div className={`mt-0.5 text-[10px] font-black uppercase tracking-widest ${physician.is_active ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>
          {physician.is_active ? 'Active' : 'Inactive'}
        </div>
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-30 w-36 border border-[#D7DEE8] bg-white shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onToggle() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]">
              {physician.is_active ? 'Disable' : 'Enable'}
            </button>
            <div className="border-t border-[#E2E8F0]" />
            <button type="button" onClick={() => { setOpen(false); onRemove() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function NurseRow({ nurse, onEdit, onResetPassword, onToggle, onRemove }: {
  nurse: NurseAccount
  onEdit: () => void
  onResetPassword: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-black text-[#0F172A]">{nurse.first_name} {nurse.last_name}</div>
        <div className="mt-0.5 text-xs font-semibold text-[#64748B]">{nurse.username}</div>
        <div className={`mt-0.5 text-[10px] font-black uppercase tracking-widest ${nurse.is_active ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>
          {nurse.is_active ? 'Active' : 'Inactive'}
        </div>
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-30 w-44 border border-[#D7DEE8] bg-white shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onEdit() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]">
              Edit
            </button>
            <button type="button" onClick={() => { setOpen(false); onResetPassword() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]">
              Reset password
            </button>
            <div className="border-t border-[#E2E8F0]" />
            <button type="button" onClick={() => { setOpen(false); onToggle() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]">
              {nurse.is_active ? 'Disable' : 'Enable'}
            </button>
            <div className="border-t border-[#E2E8F0]" />
            <button type="button" onClick={() => { setOpen(false); onRemove() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Induction physicians panel ──────────────────────────────────────────────

function InductionPhysiciansPanel() {
  const [physicians, setPhysicians] = useState<InductionPhysician[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const res = await listInductionPhysicians(true)
      setPhysicians(res.data)
    } catch {
      setError('Unable to load induction physicians.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function addPhysician(event: React.FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setError('First and last name are required.'); return }
    setSaving(true); setError('')
    try {
      await createInductionPhysician({ first_name: firstName.trim(), last_name: lastName.trim() })
      setFirstName(''); setLastName('')
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Failed to add induction physician.'))
    } finally { setSaving(false) }
  }

  async function setActive(physician: InductionPhysician, isActive: boolean) {
    setError('')
    try { await updateInductionPhysician(physician.id, { is_active: isActive }); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to update.')) }
  }

  async function removePhysician(physician: InductionPhysician) {
    setError('')
    try { await deleteInductionPhysician(physician.id); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to remove.')) }
  }

  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'
  const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]'
  const filteredPhysicians = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return physicians
    return physicians.filter((physician) => `${physician.first_name} ${physician.last_name}`.toLowerCase().includes(value))
  }, [physicians, query])
  const physicianPages = Math.max(1, Math.ceil(filteredPhysicians.length / MANAGEMENT_PAGE_SIZE))
  const physicianPage = Math.min(page, physicianPages)
  const visiblePhysicians = filteredPhysicians.slice((physicianPage - 1) * MANAGEMENT_PAGE_SIZE, physicianPage * MANAGEMENT_PAGE_SIZE)

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Add form */}
      <form onSubmit={addPhysician}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Add induction physician</div>
        </div>
        <div className="grid gap-3">
          <div>
            <label className={labelCls}>First name *</label>
            <input className={inputCls} maxLength={64} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Last name *</label>
            <input className={inputCls} maxLength={64} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">
            {saving ? 'Adding…' : 'Add physician'}
          </button>
        </div>
      </form>

      {/* List */}
      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Induction physicians</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search physicians" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredPhysicians.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No physicians match your search.' : 'No induction physicians added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visiblePhysicians.map((physician) => (
                <PhysicianRow
                  key={physician.id}
                  physician={physician}
                  onToggle={() => setActive(physician, !physician.is_active)}
                  onRemove={() => removePhysician(physician)}
                />
              ))}
            </div>
            <ManagementPagination page={physicianPage} totalItems={filteredPhysicians.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

function NursesPanel() {
  const [nurses, setNurses] = useState<NurseAccount[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'reset'>('create')
  const [selectedNurse, setSelectedNurse] = useState<NurseAccount | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const res = await listNurses(true)
      setNurses(res.data)
    } catch {
      setError('Unable to load nurses.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function clearForm() {
    setFormMode('create')
    setSelectedNurse(null)
    setUsername('')
    setPassword('')
    setFirstName('')
    setLastName('')
  }

  function editNurse(nurse: NurseAccount) {
    setError('')
    setFormMode('edit')
    setSelectedNurse(nurse)
    setUsername(nurse.username)
    setPassword('')
    setFirstName(nurse.first_name)
    setLastName(nurse.last_name)
  }

  function resetPassword(nurse: NurseAccount) {
    setError('')
    setFormMode('reset')
    setSelectedNurse(nurse)
    setUsername(nurse.username)
    setPassword('')
    setFirstName(nurse.first_name)
    setLastName(nurse.last_name)
  }

  async function submitNurse(event: React.FormEvent) {
    event.preventDefault()
    if (formMode === 'reset') {
      if (!selectedNurse || password.length < 6) {
        setError('Password must be at least 6 characters.')
        return
      }
      setSaving(true); setError('')
      try {
        await updateNurse(selectedNurse.id, { password })
        clearForm()
        await load()
      } catch (e: unknown) {
        setError(apiErrorMessage(e, 'Failed to reset password.'))
      } finally { setSaving(false) }
      return
    }

    if (!username.trim() || !firstName.trim() || !lastName.trim()) {
      setError('Username, first name, and last name are required.')
      return
    }
    if (formMode === 'create' && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSaving(true); setError('')
    try {
      if (formMode === 'edit' && selectedNurse) {
        await updateNurse(selectedNurse.id, {
          username: username.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        })
      } else {
        await createNurse({
          username: username.trim(),
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        })
      }
      clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, formMode === 'edit' ? 'Failed to update nurse.' : 'Failed to add nurse.'))
    } finally { setSaving(false) }
  }

  async function setActive(nurse: NurseAccount, isActive: boolean) {
    setError('')
    try { await updateNurse(nurse.id, { is_active: isActive }); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to update.')) }
  }

  async function removeNurse(nurse: NurseAccount) {
    setError('')
    try { await deleteNurse(nurse.id); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to remove.')) }
  }

  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'
  const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]'
  const filteredNurses = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return nurses
    return nurses.filter((nurse) => `${nurse.first_name} ${nurse.last_name} ${nurse.username}`.toLowerCase().includes(value))
  }, [nurses, query])
  const nursePages = Math.max(1, Math.ceil(filteredNurses.length / MANAGEMENT_PAGE_SIZE))
  const nursePage = Math.min(page, nursePages)
  const visibleNurses = filteredNurses.slice((nursePage - 1) * MANAGEMENT_PAGE_SIZE, nursePage * MANAGEMENT_PAGE_SIZE)

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <form onSubmit={submitNurse}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">
            {formMode === 'create' ? 'Add nurse account' : formMode === 'edit' ? 'Edit nurse account' : 'Reset nurse password'}
          </div>
        </div>
        <div className="grid gap-3">
          {formMode !== 'reset' && (
            <>
              <div>
                <label className={labelCls}>Username *</label>
                <input className={inputCls} maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              {formMode === 'create' && (
                <div>
                  <label className={labelCls}>Password *</label>
                  <input type="password" minLength={6} maxLength={128} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )}
              <div>
                <label className={labelCls}>First name *</label>
                <input className={inputCls} maxLength={64} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Last name *</label>
                <input className={inputCls} maxLength={64} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </>
          )}
          {formMode === 'reset' && (
            <>
              <div>
                <label className={labelCls}>Nurse</label>
                <div className="border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-sm font-black text-[#0F172A]">
                  {firstName} {lastName}
                </div>
              </div>
              <div>
                <label className={labelCls}>New password *</label>
                <input type="password" minLength={6} maxLength={128} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </>
          )}
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <div className="grid gap-2">
            <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">
              {saving ? 'Saving…' : formMode === 'create' ? 'Add nurse' : formMode === 'edit' ? 'Save changes' : 'Reset password'}
            </button>
            {formMode !== 'create' && (
              <button type="button" onClick={clearForm} className="h-9 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]">
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Nurses</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search nurses" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredNurses.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No nurses match your search.' : 'No nurses added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visibleNurses.map((nurse) => (
                <NurseRow
                  key={nurse.id}
                  nurse={nurse}
                  onEdit={() => editNurse(nurse)}
                  onResetPassword={() => resetPassword(nurse)}
                  onToggle={() => setActive(nurse, !nurse.is_active)}
                  onRemove={() => removeNurse(nurse)}
                />
              ))}
            </div>
            <ManagementPagination page={nursePage} totalItems={filteredNurses.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Surgeons panel ───────────────────────────────────────────────────────────

function SurgeonRow({ surgeon, caseCount, onToggle, onRemove }: {
  surgeon: Surgeon
  caseCount: number
  onToggle: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-black text-[#0F172A]">Dr. {surgeon.first_name} {surgeon.last_name}</div>
        <div className={`mt-0.5 text-[10px] font-black uppercase tracking-widest ${surgeon.is_active ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>
          {surgeon.is_active ? 'Active' : 'Inactive'} · {caseCount} case(s)
        </div>
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-30 w-36 border border-[#D7DEE8] bg-white shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onToggle() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]">
              {surgeon.is_active ? 'Disable' : 'Enable'}
            </button>
            <div className="border-t border-[#E2E8F0]" />
            <button type="button" onClick={() => { setOpen(false); onRemove() }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SurgeonsPanel({ cases }: { cases: Case[] }) {
  const [surgeons, setSurgeons] = useState<Surgeon[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const caseCountById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of cases) map[c.doctor.id] = (map[c.doctor.id] ?? 0) + 1
    return map
  }, [cases])

  async function load() {
    setError('')
    try {
      const res = await listDoctors(true)
      setSurgeons(res.data)
    } catch {
      setError('Unable to load surgeons.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function addSurgeon(event: React.FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setError('First and last name are required.'); return }
    setSaving(true); setError('')
    try {
      await createDoctor({ first_name: firstName.trim(), last_name: lastName.trim() })
      setFirstName(''); setLastName('')
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Failed to add surgeon.'))
    } finally { setSaving(false) }
  }

  async function setActive(surgeon: Surgeon, isActive: boolean) {
    setError('')
    try { await updateDoctor(surgeon.id, { is_active: isActive }); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to update.')) }
  }

  async function removeSurgeon(surgeon: Surgeon) {
    setError('')
    try { await deleteDoctor(surgeon.id); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to remove.')) }
  }

  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'
  const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]'
  const filteredSurgeons = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return surgeons
    return surgeons.filter((surgeon) => `${surgeon.first_name} ${surgeon.last_name}`.toLowerCase().includes(value))
  }, [surgeons, query])
  const surgeonPages = Math.max(1, Math.ceil(filteredSurgeons.length / MANAGEMENT_PAGE_SIZE))
  const surgeonPage = Math.min(page, surgeonPages)
  const visibleSurgeons = filteredSurgeons.slice((surgeonPage - 1) * MANAGEMENT_PAGE_SIZE, surgeonPage * MANAGEMENT_PAGE_SIZE)

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Add form */}
      <form onSubmit={addSurgeon}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Add surgeon</div>
        </div>
        <div className="grid gap-3">
          <div>
            <label className={labelCls}>First name *</label>
            <input className={inputCls} maxLength={64} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Last name *</label>
            <input className={inputCls} maxLength={64} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">
            {saving ? 'Adding…' : 'Add surgeon'}
          </button>
        </div>
      </form>

      {/* List */}
      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Surgeons</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search surgeons" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredSurgeons.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No surgeons match your search.' : 'No surgeons added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visibleSurgeons.map((surgeon) => (
                <SurgeonRow
                  key={surgeon.id}
                  surgeon={surgeon}
                  caseCount={caseCountById[surgeon.id] ?? 0}
                  onToggle={() => setActive(surgeon, !surgeon.is_active)}
                  onRemove={() => removeSurgeon(surgeon)}
                />
              ))}
            </div>
            <ManagementPagination page={surgeonPage} totalItems={filteredSurgeons.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Surgeries panel ─────────────────────────────────────────────────────────

function SurgeriesPanel() {
  const [surgeries, setSurgeries] = useState<Surgery[]>([])
  const [selected, setSelected] = useState<Surgery | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const response = await listSurgeries(true)
      setSurgeries(response.data)
    } catch {
      setError('Unable to load surgeries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function clearForm() {
    setSelected(null)
    setName('')
    setError('')
  }

  function editSurgery(surgery: Surgery) {
    setSelected(surgery)
    setName(surgery.name)
    setError('')
  }

  async function submitSurgery(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Surgery name is required.'); return }
    setSaving(true); setError('')
    try {
      if (selected) await updateSurgery(selected.id, { name: name.trim() })
      else await createSurgery({ name: name.trim() })
      clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, selected ? 'Failed to update surgery.' : 'Failed to add surgery.'))
    } finally {
      setSaving(false)
    }
  }

  async function setActive(surgery: Surgery, isActive: boolean) {
    setError('')
    try { await updateSurgery(surgery.id, { is_active: isActive }); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to update surgery.')) }
  }

  async function removeSurgery(surgery: Surgery) {
    setError('')
    try {
      await deleteSurgery(surgery.id)
      if (selected?.id === surgery.id) clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Failed to remove surgery.'))
    }
  }

  const filteredSurgeries = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return surgeries
    return surgeries.filter((surgery) => surgery.name.toLowerCase().includes(value))
  }, [surgeries, query])
  const surgeryPages = Math.max(1, Math.ceil(filteredSurgeries.length / MANAGEMENT_PAGE_SIZE))
  const surgeryPage = Math.min(page, surgeryPages)
  const visibleSurgeries = filteredSurgeries.slice((surgeryPage - 1) * MANAGEMENT_PAGE_SIZE, surgeryPage * MANAGEMENT_PAGE_SIZE)
  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <form onSubmit={submitSurgery}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">{selected ? 'Edit surgery' : 'Add surgery'}</div>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Surgery name *</label>
            <input className={inputCls} maxLength={256} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">{saving ? 'Saving…' : selected ? 'Save' : 'Add'}</button>
          {selected && <button type="button" onClick={clearForm} className="h-9 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]">Cancel</button>}
        </div>
      </form>

      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Surgeries</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search surgeries" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredSurgeries.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No surgeries match your search.' : 'No surgeries added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visibleSurgeries.map((surgery) => (
                <div key={surgery.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-[#0F172A]">{surgery.name}</div>
                    <div className={`mt-0.5 text-[10px] font-black uppercase tracking-widest ${surgery.is_active ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>{surgery.is_active ? 'Active' : 'Inactive'}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => editSurgery(surgery)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F1F5F9]">Edit</button>
                    <button type="button" onClick={() => setActive(surgery, !surgery.is_active)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F1F5F9]">{surgery.is_active ? 'Disable' : 'Enable'}</button>
                    <button type="button" onClick={() => removeSurgery(surgery)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <ManagementPagination page={surgeryPage} totalItems={filteredSurgeries.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Companies panel ─────────────────────────────────────────────────────────

function CompaniesPanel() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Company | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const response = await listCompanies()
      setCompanies(response.data)
    } catch {
      setError('Unable to load companies.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function clearForm() {
    setSelected(null)
    setName('')
    setError('')
  }

  function editCompany(company: Company) {
    setSelected(company)
    setName(company.name)
    setError('')
  }

  async function submitCompany(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Company name is required.'); return }
    setSaving(true); setError('')
    try {
      if (selected) await updateCompany(selected.id, { name: name.trim() })
      else await createCompany({ name: name.trim() })
      clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, selected ? 'Failed to update company.' : 'Failed to add company.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeCompany(company: Company) {
    setError('')
    try {
      await deleteCompany(company.id)
      if (selected?.id === company.id) clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Failed to remove company.'))
    }
  }

  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'
  const filteredCompanies = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return companies
    return companies.filter((company) => company.name.toLowerCase().includes(value))
  }, [companies, query])
  const companyPages = Math.max(1, Math.ceil(filteredCompanies.length / MANAGEMENT_PAGE_SIZE))
  const companyPage = Math.min(page, companyPages)
  const visibleCompanies = filteredCompanies.slice((companyPage - 1) * MANAGEMENT_PAGE_SIZE, companyPage * MANAGEMENT_PAGE_SIZE)

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <form onSubmit={submitCompany}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">
            {selected ? 'Edit company' : 'Add company'}
          </div>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Company name *</label>
            <input className={inputCls} maxLength={128} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">
            {saving ? 'Saving…' : selected ? 'Save' : 'Add'}
          </button>
          {selected && (
            <button type="button" onClick={clearForm} className="h-9 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Companies</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search companies" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredCompanies.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No companies match your search.' : 'No companies added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visibleCompanies.map((company) => (
                <div key={company.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 truncate text-sm font-black text-[#0F172A]">{company.name}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => editCompany(company)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F1F5F9]">Edit</button>
                    <button type="button" onClick={() => removeCompany(company)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <ManagementPagination page={companyPage} totalItems={filteredCompanies.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Hospital rooms panel ────────────────────────────────────────────────────

function HospitalRoomsPanel() {
  const [hospitalRooms, setHospitalRooms] = useState<HospitalRoom[]>([])
  const [selected, setSelected] = useState<HospitalRoom | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const response = await listHospitalRooms(true)
      setHospitalRooms(response.data)
    } catch {
      setError('Unable to load hospital rooms.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function clearForm() {
    setSelected(null)
    setName('')
    setError('')
  }

  function editRoom(room: HospitalRoom) {
    setSelected(room)
    setName(room.name)
    setError('')
  }

  async function submitRoom(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Hospital room name is required.'); return }
    setSaving(true); setError('')
    try {
      if (selected) await updateHospitalRoom(selected.id, { name: name.trim() })
      else await createHospitalRoom({ name: name.trim() })
      clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, selected ? 'Failed to update hospital room.' : 'Failed to add hospital room.'))
    } finally {
      setSaving(false)
    }
  }

  async function setActive(room: HospitalRoom, isActive: boolean) {
    setError('')
    try { await updateHospitalRoom(room.id, { is_active: isActive }); await load() }
    catch (e: unknown) { setError(apiErrorMessage(e, 'Failed to update hospital room.')) }
  }

  async function removeRoom(room: HospitalRoom) {
    setError('')
    try {
      await deleteHospitalRoom(room.id)
      if (selected?.id === room.id) clearForm()
      await load()
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Failed to remove hospital room.'))
    }
  }

  const filteredRooms = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return hospitalRooms
    return hospitalRooms.filter((room) => room.name.toLowerCase().includes(value))
  }, [hospitalRooms, query])
  const roomPages = Math.max(1, Math.ceil(filteredRooms.length / MANAGEMENT_PAGE_SIZE))
  const roomPage = Math.min(page, roomPages)
  const visibleRooms = filteredRooms.slice((roomPage - 1) * MANAGEMENT_PAGE_SIZE, roomPage * MANAGEMENT_PAGE_SIZE)
  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <form onSubmit={submitRoom}>
        <div className="mb-4 border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">{selected ? 'Edit hospital room' : 'Add hospital room'}</div>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Room name *</label>
            <input className={inputCls} maxLength={64} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>}
          <button disabled={saving} className="h-9 bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40">
            {saving ? 'Saving…' : selected ? 'Save' : 'Add'}
          </button>
          {selected && <button type="button" onClick={clearForm} className="h-9 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]">Cancel</button>}
        </div>
      </form>

      <div>
        <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Hospital rooms</div>
          <ManagementToolbar query={query} onQueryChange={(value) => { setQuery(value); setPage(1) }} onRefresh={load} placeholder="Search rooms" />
        </div>
        {loading ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
        ) : filteredRooms.length === 0 ? (
          <div className="py-8 text-sm font-semibold text-[#94A3B8]">{query ? 'No rooms match your search.' : 'No hospital rooms added yet.'}</div>
        ) : (
          <>
            <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
              {visibleRooms.map((room) => (
                <div key={room.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-[#0F172A]">{room.name}</div>
                    <div className={`mt-0.5 text-[10px] font-black uppercase tracking-widest ${room.is_active ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>{room.is_active ? 'Active' : 'Inactive'}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => editRoom(room)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F1F5F9]">Edit</button>
                    <button type="button" onClick={() => setActive(room, !room.is_active)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F1F5F9]">{room.is_active ? 'Disable' : 'Enable'}</button>
                    <button type="button" onClick={() => removeRoom(room)} className="h-8 px-3 text-[10px] font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]">Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <ManagementPagination page={roomPage} totalItems={filteredRooms.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { rooms, setRooms } = useORStore()
  const [cases, setCases] = useState<Case[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('cases')
  const [physicianSubTab, setPhysicianSubTab] = useState<PhysicianSubTab>('induction')

  const loadData = async () => {
    const [roomsRes, casesRes] = await Promise.all([listRooms(), listAdminCases()])
    setRooms([...roomsRes.data].sort((a, b) => a.room_code.localeCompare(b.room_code, undefined, { numeric: true })))
    setCases(casesRes.data)
  }

  useEffect(() => { loadData() }, [])

  // ── Live updates: refresh case list when anything relevant changes elsewhere
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    let ws: WebSocket | null = null
    let dead = false
    let retry = 0
    const BACKOFF = [1000, 2000, 4000, 8000, 30000]
    const RELOAD_EVENTS = new Set([
      'phase_transition',
      'cancellation_requested',
      'schedule_changed',
      'schedule_shifted',
      'room_reassigned',
    ])

    function connect() {
      if (dead) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${window.location.host}/ws/dashboard`)

      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }))

      ws.onmessage = (e) => {
        let msg: { type?: string; event?: string }
        try { msg = JSON.parse(e.data) } catch { return }

        if (msg.type === 'auth_ok') { retry = 0; return }
        if (msg.event && RELOAD_EVENTS.has(msg.event)) loadData()
      }

      ws.onclose = () => {
        if (dead) return
        const delay = BACKOFF[Math.min(retry++, BACKOFF.length - 1)]
        setTimeout(connect, delay)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      dead = true
      ws?.close()
    }
  }, [])

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'cases', label: 'Cases', count: cases.length },
    { key: 'physicians', label: 'Management' },
  ]

  return (
    <div className="flex h-[calc(100dvh-var(--app-nav-height))] min-h-0 flex-col overflow-hidden bg-white">

      {/* Top tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#E2E8F0] px-3 sm:px-5 lg:px-8">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative h-11 px-4 text-xs font-black uppercase tracking-widest transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-[#0F2044] text-[#0F2044]'
                : 'text-[#94A3B8] hover:text-[#0F172A]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 px-1.5 py-0.5 text-[9px] font-black ${
                activeTab === tab.key ? 'bg-[#0F2044] text-white' : 'bg-[#F1F5F9] text-[#94A3B8]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">

        {activeTab === 'cases' && (
          <AdminCasesPanel cases={cases} rooms={rooms} onRefresh={loadData} />
        )}

        {activeTab === 'physicians' && (
          <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
            {/* Side nav */}
            <aside className="flex w-full shrink-0 flex-row overflow-x-auto border-b border-[#E2E8F0] bg-[#F8FAFC] px-2 py-2 md:w-48 md:flex-col md:border-b-0 md:border-r md:px-3 md:py-4">
              {(['induction', 'surgeons', 'surgeries', 'nurses', 'companies', 'hospital_rooms', 'import'] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => setPhysicianSubTab(sub)}
                  className={`h-10 shrink-0 border-b-4 px-3 text-left text-[10px] font-black uppercase tracking-wide transition-colors md:h-9 md:border-b-0 md:border-l-4 md:text-xs md:tracking-widest ${
                    physicianSubTab === sub
                      ? 'border-[#0F2044] bg-white text-[#0F2044]'
                      : 'border-transparent text-[#64748B] hover:border-[#CBD5E1] hover:text-[#0F172A]'
                  }`}
                >
                  {sub === 'induction' ? 'Induction' : sub === 'surgeons' ? 'Surgeons' : sub === 'surgeries' ? 'Surgeries' : sub === 'nurses' ? 'Nurses' : sub === 'companies' ? 'Companies' : sub === 'hospital_rooms' ? 'Hospital rooms' : 'Import schedule'}
                </button>
              ))}
            </aside>
            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
              {physicianSubTab === 'induction' && <InductionPhysiciansPanel />}
              {physicianSubTab === 'surgeons' && <SurgeonsPanel cases={cases} />}
              {physicianSubTab === 'surgeries' && <SurgeriesPanel />}
              {physicianSubTab === 'nurses' && <NursesPanel />}
              {physicianSubTab === 'companies' && <CompaniesPanel />}
              {physicianSubTab === 'hospital_rooms' && <HospitalRoomsPanel />}
              {physicianSubTab === 'import' && <ImportPanel onImported={loadData} />}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

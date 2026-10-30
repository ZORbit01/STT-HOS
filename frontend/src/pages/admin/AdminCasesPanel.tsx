import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { cancelCaseDirect, confirmCancellation, createCase, deleteCase, getCase, rejectCancellation, resetVoiceCaseCodes, transitionCase, updateCase, type CaseCreatePayload, type CaseUpdatePayload } from '../../api/cases'
import { listClientRooms } from '../../api/clientSessions'
import { apiErrorMessage } from '../../api/errors'
import { exportFilteredCases } from '../../api/exports'
import { listHospitalRooms } from '../../api/hospitalRooms'
import { listCompanies } from '../../api/companies'
import { listSurgeries } from '../../api/surgeries'
import type { Case, CaseDetail, CasePhase, ClientRoomOccupancy, Company, HospitalRoom, Room, Surgeon, Surgery } from '../../types'
import { listDoctors } from '../../api/doctors'
import { DELAY_REASON_LABEL } from '../../utils/delayReason'

function DoctorSelect({ value, onChange, doctors }: { value: string; onChange: (doctorId: string) => void; doctors: Surgeon[] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = doctors.find((d) => d.id === value)
  const normalized = query.trim().toLowerCase()
  const matches = normalized.length > 0
    ? doctors.filter((d) => `${d.first_name} ${d.last_name}`.toLowerCase().includes(normalized) || d.last_name.toLowerCase().includes(normalized)).slice(0, 20)
    : doctors.slice(0, 20)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function select(d: Surgeon) {
    onChange(d.id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between border border-[#CBD5E1] bg-white px-3 text-left text-sm font-semibold outline-none transition focus:border-[#0F2044]"
      >
        <span className={selected ? 'text-[#0F172A]' : 'text-[#94A3B8]'}>
          {selected ? `Dr. ${selected.first_name} ${selected.last_name}` : 'Select a surgeon…'}
        </span>
        <span className="text-[10px] text-[#94A3B8]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full border border-[#CBD5E1] bg-white shadow-lg">
          <input
            className="h-9 w-full border-b border-[#E2E8F0] px-3 text-sm font-semibold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search surgeons…"
            autoComplete="off"
            autoFocus
          />
          <ul className="max-h-52 overflow-y-auto">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-xs font-semibold text-[#94A3B8]">
                No surgeon found. Add them in the Surgeons tab.
              </li>
            ) : (
              matches.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => select(d)}
                    className={`w-full px-3 py-2 text-left text-sm font-semibold hover:bg-[#F1F5F9] ${d.id === value ? 'bg-[#EEF6FF] text-[#0F2044]' : 'text-[#0F172A]'}`}
                  >
                    Dr. {d.first_name} {d.last_name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function CompanyMultiSelect({
  value,
  onChange,
  companies,
}: {
  value: string[]
  onChange: (companies: string[]) => void
  companies: Company[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const normalized = query.trim().toLowerCase()
  const selectedNames = new Set(value.map((name) => name.toLowerCase()))
  const matches = companies
    .filter((company) => !selectedNames.has(company.name.toLowerCase()))
    .filter((company) => !normalized || company.name.toLowerCase().includes(normalized))
    .slice(0, 8)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function addCompany(rawName: string) {
    const name = rawName.trim().replace(/\s+/g, ' ')
    if (!name || selectedNames.has(name.toLowerCase()) || value.length >= 20) {
      setQuery('')
      return
    }
    onChange([...value, name])
    setQuery('')
    setOpen(true)
  }

  function removeCompany(name: string) {
    onChange(value.filter((item) => item !== name))
  }

  return (
    <div ref={ref} className="relative">
      <div
        className="min-h-10 border border-[#CBD5E1] bg-white px-2 py-1.5 transition focus-within:border-[#0F2044] focus-within:ring-1 focus-within:ring-[#0F2044]/10"
        onClick={() => setOpen(true)}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((name) => (
            <span key={name} className="inline-flex h-7 items-center gap-1 bg-[#EAF2FF] pl-2.5 pr-1.5 text-xs font-bold text-[#0F2044]">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => removeCompany(name)}
                className="grid h-5 w-5 place-items-center text-sm text-[#64748B] transition hover:bg-white hover:text-[#B91C1C]"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ',') && query.trim()) {
                event.preventDefault()
                addCompany(query.replace(/,$/, ''))
              } else if (event.key === 'Backspace' && !query && value.length > 0) {
                removeCompany(value[value.length - 1])
              }
            }}
            className="h-7 min-w-36 flex-1 bg-transparent px-1 text-sm font-semibold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
            placeholder={value.length ? 'Add another…' : 'Search or type a company…'}
            maxLength={128}
            autoComplete="off"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={() => addCompany(query)}
              className="h-7 bg-[#0F2044] px-2.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#193461]"
            >
              Add
            </button>
          )}
        </div>
      </div>
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-44 w-full overflow-y-auto border border-[#CBD5E1] bg-white py-1 shadow-lg">
          {matches.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addCompany(company.name)}
                className="w-full px-3 py-2 text-left text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9]"
              >
                {company.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProcedureSearch({ value, onChange, surgeries }: {
  value: string
  onChange: (value: string) => void
  surgeries: Surgery[]
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const available = surgeries.filter((surgery) => surgery.is_active || surgery.name === value)
  const normalized = query.trim().toLowerCase()
  const matches = (normalized
    ? available.filter((surgery) => surgery.name.toLowerCase().includes(normalized))
    : available
  ).slice(0, 12)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Sync external value → local query when form resets
  useEffect(() => { setQuery(value) }, [value])

  function select(surgery: Surgery) {
    setQuery(surgery.name)
    onChange(surgery.name)
    setOpen(false)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    onChange('')
    setOpen(true)
  }

  return (
    <div ref={ref} className="relative">
      <input
        className="h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]"
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder="Type to search procedures…"
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto border border-[#CBD5E1] bg-white shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs font-semibold text-[#94A3B8]">No surgery found. Add it in Management → Surgeries.</li>
          ) : matches.map((surgery) => (
            <li key={surgery.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(surgery)}
                className="w-full px-3 py-2 text-left text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9]"
              >
                {surgery.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type CaseFilter = 'active' | 'upcoming' | 'completed' | 'all'
type SortKey = 'code' | 'procedure' | 'room' | 'planned' | 'actual_in' | 'actual_out' | 'planned_end' | 'duration' | 'phase'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 10

const PHASE_LABEL: Record<CasePhase, string> = {
  IDLE: 'Scheduled',
  IN: 'In room',
  INDUCTION: 'Induction',
  INCISION: 'Incision',
  CLOSURE: 'Closure',
  OUT: 'Out',
  CLEANING: 'Cleaning',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
}

const NEXT_PHASE: Partial<Record<CasePhase, CasePhase>> = {
  IDLE: 'IN',
  IN: 'INDUCTION',
  INDUCTION: 'INCISION',
  INCISION: 'CLOSURE',
  CLOSURE: 'OUT',
  OUT: 'CLEANING',
  CLEANING: 'COMPLETE',
}

interface CaseFormState {
  procedure_name: string
  estimated_duration_min: string
  scheduled_date: string
  scheduled_time: string
  scheduled_room_code: string
  doctor_id: string
  patient_first_name: string
  patient_last_name: string
  patient_mrn: string
  patient_age: string
  patient_sex: string
  company_names: string[]
  isolation_required: boolean
  notes: string
  patient_room: string
  actual_start_at: string
  expected_end_at: string
  actual_end_at: string
}

const EMPTY_CASE_FORM: CaseFormState = {
  procedure_name: '',
  estimated_duration_min: '60',
  scheduled_date: '',
  scheduled_time: '',
  scheduled_room_code: '',
  doctor_id: '',
  patient_first_name: '',
  patient_last_name: '',
  patient_mrn: '',
  patient_age: '',
  patient_sex: '',
  company_names: [],
  isolation_required: false,
  notes: '',
  patient_room: '',
  actual_start_at: '',
  expected_end_at: '',
  actual_end_at: '',
}

function displayCode(c: Case) {
  return c.voice_case_code ?? c.case_code
}

function clock(iso: string | null | undefined) {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dateTime(iso: string | null | undefined) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const HOSPITAL_TIME_ZONE = 'Asia/Beirut'

function hospitalDateTimeParts(iso: string | null | undefined) {
  if (!iso) return { date: '', time: '' }
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOSPITAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

function todayInHospitalTimeZone() {
  return hospitalDateTimeParts(new Date().toISOString()).date
}

function hospitalTimeZoneOffsetMs(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOSPITAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0)
  const representedAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return representedAsUtc - instant.getTime()
}

function scheduledStartIso(scheduleDate: string, scheduleTime: string) {
  const [year, month, day] = scheduleDate.split('-').map(Number)
  const [hour, minute] = scheduleTime.split(':').map(Number)
  const localWallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let offset = hospitalTimeZoneOffsetMs(new Date(localWallClockAsUtc))
  let instant = new Date(localWallClockAsUtc - offset)
  const correctedOffset = hospitalTimeZoneOffsetMs(instant)
  if (correctedOffset !== offset) {
    offset = correctedOffset
    instant = new Date(localWallClockAsUtc - offset)
  }
  return instant.toISOString()
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null
}

function formFromCase(detail: CaseDetail): CaseFormState {
  const scheduled = hospitalDateTimeParts(detail.scheduled_start)
  return {
    procedure_name: detail.procedure_name,
    estimated_duration_min: String(detail.estimated_duration_min),
    scheduled_date: scheduled.date,
    scheduled_time: scheduled.time,
    scheduled_room_code: detail.scheduled_room_code,
    doctor_id: detail.doctor.id,
    patient_first_name: detail.patient?.first_name ?? '',
    patient_last_name: detail.patient?.last_name ?? '',
    patient_mrn: detail.patient?.mrn ?? '',
    patient_age: detail.patient_age == null ? '' : String(detail.patient_age),
    patient_sex: detail.patient_sex ?? '',
    company_names: detail.companies.map((company) => company.name),
    isolation_required: detail.isolation_required,
    notes: detail.notes ?? '',
    patient_room: detail.patient_room ?? '',
    actual_start_at: toLocalInputValue(detail.actual_start_at),
    expected_end_at: toLocalInputValue(detail.expected_end_at),
    actual_end_at: toLocalInputValue(detail.actual_end_at),
  }
}

function predictedEnd(c: Case) {
  return c.expected_end_at ?? new Date(new Date(c.scheduled_start).getTime() + c.estimated_duration_min * 60_000).toISOString()
}

function patientLine(c: Case) {
  if (c.patient) {
    const age = c.patient.age ? ` ${c.patient.age}` : ''
    const sex = c.patient.sex ?? ''
    return `${c.patient.first_name} ${c.patient.last_name}${age}${sex}`.trim()
  }
  return c.patient_name || 'No patient linked'
}

function filterCase(c: Case, filter: CaseFilter, scheduleDate: string, hasDateTimeRange = false) {
  if (filter === 'all') return true
  if (filter === 'completed') return c.current_phase === 'COMPLETE' || c.current_phase === 'CANCELLED'
  // Upcoming is scoped to the selected schedule date (defaults to today) so it
  // remains operationally useful. An explicit range unlocks other dates.
  if (filter === 'upcoming') {
    return c.current_phase === 'IDLE'
      && (hasDateTimeRange || hospitalDateTimeParts(c.scheduled_start).date === scheduleDate)
  }
  return c.current_phase !== 'IDLE' && c.current_phase !== 'COMPLETE' && c.current_phase !== 'CANCELLED'
}

function scheduledLocalMinute(c: Case) {
  const scheduled = hospitalDateTimeParts(c.scheduled_start)
  return scheduled.date && scheduled.time ? `${scheduled.date}T${scheduled.time}` : ''
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-[#F1F5F9] py-2">
      <div className="text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">{label}</div>
      <div className="min-w-0 truncate text-sm font-semibold text-[#374151]">{value ?? <span className="text-[#CBD5E1]">—</span>}</div>
    </div>
  )
}

function CaseFormPanel({
  mode,
  rooms,
  doctors,
  companies,
  hospitalRooms,
  surgeries,
  detail,
  onCancel,
  onSaved,
  defaultScheduleDate = '',
}: {
  mode: 'create' | 'edit'
  rooms: Room[]
  doctors: Surgeon[]
  companies: Company[]
  hospitalRooms: HospitalRoom[]
  surgeries: Surgery[]
  detail?: CaseDetail
  onCancel: () => void
  onSaved: () => void
  defaultScheduleDate?: string
}) {
  const [form, setForm] = useState<CaseFormState>(() => {
    const base = detail ? formFromCase(detail) : { ...EMPTY_CASE_FORM, scheduled_date: defaultScheduleDate }
    const defaultRoom = base.scheduled_room_code || rooms[0]?.room_code || 'OR1'
    return {
      ...base,
      scheduled_room_code: defaultRoom,
      patient_room: base.patient_room,
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const base = detail ? formFromCase(detail) : { ...EMPTY_CASE_FORM, scheduled_date: defaultScheduleDate }
    const defaultRoom = base.scheduled_room_code || rooms[0]?.room_code || 'OR1'
    setForm({
      ...base,
      scheduled_room_code: defaultRoom,
      patient_room: base.patient_room,
    })
    setError('')
  }, [defaultScheduleDate, detail, mode, rooms])

  const set = (key: keyof CaseFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setOperatingRoom(value: string) {
    set('scheduled_room_code', value)
  }

  const predicted = form.scheduled_date && form.scheduled_time
    ? dateTime(new Date(new Date(scheduledStartIso(form.scheduled_date, form.scheduled_time)).getTime() + (parseInt(form.estimated_duration_min, 10) || 0) * 60_000).toISOString())
    : '-'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.procedure_name.trim() || !form.scheduled_date || !form.scheduled_time || !form.doctor_id) {
      setError('Procedure, planned date and time, and surgeon are required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const shared = {
        procedure_name: form.procedure_name.trim(),
        estimated_duration_min: parseInt(form.estimated_duration_min, 10) || 60,
        scheduled_start: scheduledStartIso(form.scheduled_date, form.scheduled_time),
        scheduled_room_code: form.scheduled_room_code,
        doctor_id: form.doctor_id,
        patient_first_name: form.patient_first_name.trim() || undefined,
        patient_last_name: form.patient_last_name.trim() || undefined,
        patient_mrn: form.patient_mrn.trim() || null,
        patient_age: form.patient_age ? parseInt(form.patient_age, 10) : null,
        patient_sex: form.patient_sex || null,
        company_names: form.company_names,
        isolation_required: form.isolation_required,
        notes: form.notes.trim() || null,
        patient_room: form.patient_room.trim() || null,
      }

      if (mode === 'create') {
        const payload: CaseCreatePayload = {
          ...shared,
          patient_mrn: shared.patient_mrn ?? undefined,
          patient_age: shared.patient_age ?? undefined,
          patient_sex: shared.patient_sex ?? undefined,
          notes: shared.notes ?? undefined,
          patient_room: shared.patient_room ?? undefined,
        }
        await createCase(payload)
      } else if (detail) {
        const payload: CaseUpdatePayload = {
          ...shared,
          actual_start_at: toIso(form.actual_start_at),
          expected_end_at: toIso(form.expected_end_at),
          actual_end_at: toIso(form.actual_end_at),
        }
        await updateCase(detail.case_code, payload)
      }

      onSaved()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, `Failed to ${mode === 'create' ? 'create' : 'update'} case`))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'h-9 w-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]'
  const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]'
  const groupTitle = 'text-xs font-black uppercase tracking-widest text-[#0F172A]'

  return (
    <aside className="fixed inset-x-0 bottom-0 top-[var(--app-nav-height)] z-[1200] min-h-0 border-l border-[#D7DEE8] bg-white shadow-[-18px_0_45px_rgba(15,23,42,0.16)] sm:left-auto sm:w-[440px] 2xl:static 2xl:z-auto 2xl:w-auto 2xl:shadow-none">
      <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{mode === 'create' ? 'New case' : 'Edit case'}</div>
            <div className="mt-1 text-xl font-black text-[#0F172A]">{mode === 'create' ? 'Manual entry' : displayCode(detail!)}</div>
          </div>
          <button type="button" onClick={onCancel} className="h-8 px-3 text-xs font-black uppercase tracking-wide text-[#64748B] transition hover:bg-[#F8FAFC] hover:text-[#0F172A]">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Procedure *</label>
              <ProcedureSearch value={form.procedure_name} onChange={(v) => set('procedure_name', v)} surgeries={surgeries} />
            </div>

            <div className="col-span-2 pt-2"><div className={groupTitle}>Physician</div></div>
            <div className="col-span-2">
              <label className={labelCls}>Surgeon *</label>
              <DoctorSelect
                value={form.doctor_id}
                doctors={doctors}
                onChange={(doctorId) => set('doctor_id', doctorId)}
              />
            </div>

            <div className="col-span-2 pt-2"><div className={groupTitle}>Patient</div></div>
            <div>
              <label className={labelCls}>First name</label>
              <input className={inputCls} value={form.patient_first_name} onChange={(event) => set('patient_first_name', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input className={inputCls} value={form.patient_last_name} onChange={(event) => set('patient_last_name', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>MRN</label>
              <input className={inputCls} value={form.patient_mrn} onChange={(event) => set('patient_mrn', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Age</label>
              <input className={inputCls} type="number" min="0" value={form.patient_age} onChange={(event) => set('patient_age', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Sex</label>
              <select className={inputCls} value={form.patient_sex} onChange={(event) => set('patient_sex', event.target.value)}>
                <option value="">Unknown</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Current hospital room</label>
              <select
                className={inputCls}
                value={form.patient_room}
                onChange={(event) => set('patient_room', event.target.value)}
              >
                <option value="">None</option>
                {form.patient_room && !hospitalRooms.some((room) => room.name === form.patient_room) && (
                  <option value={form.patient_room}>{form.patient_room}</option>
                )}
                {hospitalRooms.map((room) => <option key={room.id} value={room.name}>{room.name}</option>)}
              </select>
            </div>

            <div className="col-span-2 pt-2"><div className={groupTitle}>Case details</div></div>
            <div className="col-span-2">
              <label className={labelCls}>Companies</label>
              <CompanyMultiSelect
                value={form.company_names}
                companies={companies}
                onChange={(companyNames) => setForm((current) => ({ ...current, company_names: companyNames }))}
              />
            </div>
            <div className="col-span-2 flex items-center justify-between border border-[#D7DEE8] bg-[#F8FAFC] px-3 py-3">
              <div>
                <div className="text-xs font-black text-[#0F172A]">Isolation precautions</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.isolation_required}
                aria-label="Isolation precautions required"
                onClick={() => setForm((current) => ({ ...current, isolation_required: !current.isolation_required }))}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${form.isolation_required ? 'bg-[#B91C1C]' : 'bg-[#CBD5E1]'}`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${form.isolation_required ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea
                className="min-h-24 w-full resize-y border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-semibold leading-5 text-[#0F172A] outline-none transition placeholder:font-normal placeholder:text-[#94A3B8] focus:border-[#0F2044]"
                value={form.notes}
                onChange={(event) => set('notes', event.target.value)}
                placeholder="Lens type, equipment details, or other clerk notes…"
                maxLength={2000}
              />
              <div className="mt-1 text-right text-[10px] font-semibold text-[#94A3B8]">{form.notes.length} / 2000</div>
            </div>

            <div className="col-span-2 pt-2"><div className={groupTitle}>Schedule</div></div>
            <div>
              <label className={labelCls}>Operating room</label>
              <select className={inputCls} value={form.scheduled_room_code} onChange={(event) => setOperatingRoom(event.target.value)}>
                {rooms.map((room) => <option key={room.id} value={room.room_code}>{room.room_code}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Duration min</label>
              <input className={inputCls} type="number" min="1" value={form.estimated_duration_min} onChange={(event) => set('estimated_duration_min', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Planned date *</label>
              <input className={inputCls} type="date" value={form.scheduled_date} onChange={(event) => set('scheduled_date', event.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Planned time *</label>
              <input className={inputCls} type="time" value={form.scheduled_time} onChange={(event) => set('scheduled_time', event.target.value)} />
            </div>
            <div className="col-span-2 border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#64748B]">
              Predicted end from plan: <span className="font-mono text-[#0F172A]">{predicted}</span>
            </div>

            {mode === 'edit' && (
              <>
                <div>
                  <label className={labelCls}>Actual in</label>
                  <input className={inputCls} type="datetime-local" value={form.actual_start_at} onChange={(event) => set('actual_start_at', event.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Expected end</label>
                  <input className={inputCls} type="datetime-local" value={form.expected_end_at} onChange={(event) => set('expected_end_at', event.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Actual complete</label>
                  <input className={inputCls} type="datetime-local" value={form.actual_end_at} onChange={(event) => set('actual_end_at', event.target.value)} />
                </div>
              </>
            )}

            {error && (
              <div className="col-span-2 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 border border-[#CBD5E1] px-3 text-xs font-black uppercase tracking-wide text-[#475569] transition hover:border-[#94A3B8] hover:bg-[#F8FAFC]">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="h-9 bg-[#0F2044] px-3 text-xs font-black uppercase tracking-wide text-white transition hover:bg-[#19315F] disabled:opacity-50">
            {saving ? 'Saving' : mode === 'create' ? 'Create Case' : 'Save Changes'}
          </button>
        </div>
      </form>
    </aside>
  )
}

function PhaseEventRow({ event }: { event: import('../../types').PhaseEvent }) {
  const outcomeColor =
    event.outcome === 'ACCEPTED' ? 'text-[#16A34A]' :
    event.outcome === 'REJECTED' ? 'text-[#DC2626]' :
    event.outcome === 'REVIEW'   ? 'text-[#D97706]' :
    'text-[#94A3B8]'
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-[#0F172A]">
          <span className="text-[#94A3B8]">{PHASE_LABEL[event.from_phase]}</span>
          <span className="mx-1.5 text-[#CBD5E1]">→</span>
          <span>{PHASE_LABEL[event.to_phase]}</span>
        </div>
        <div className="font-mono text-xs font-semibold text-[#94A3B8]">{clock(event.actual_time)}</div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">{event.source}</span>
        <span className="text-[#CBD5E1]">·</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${outcomeColor}`}>{event.outcome}</span>
        {event.confidence_score !== null && (
          <><span className="text-[#CBD5E1]">·</span><span className="text-[10px] font-semibold text-[#94A3B8]">{Math.round(event.confidence_score * 100)}%</span></>
        )}
        {event.delay_minutes !== null && (
          <><span className="text-[#CBD5E1]">·</span><span className="text-[10px] font-semibold text-[#D97706]">{Math.round(event.delay_minutes)}m delay</span></>
        )}
      </div>
      <div className="mt-1 text-xs font-semibold text-[#94A3B8]">
        Nurse <span className="font-black text-[#374151]">{event.triggered_by_nurse_name ?? 'Unknown'}</span>
      </div>
      {event.induction_physician_name && (
        <div className="mt-1 text-xs font-semibold text-[#94A3B8]">
          Induction <span className="font-black text-[#374151]">{event.induction_physician_name}</span>
        </div>
      )}
      {event.raw_transcript && (
        <div className="mt-1 text-xs italic text-[#94A3B8]">"{event.raw_transcript}"</div>
      )}
    </div>
  )
}

function InductionAssignmentRow({ assignment }: { assignment: import('../../types').InductionPhysicianAssignment }) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-black text-[#0F172A]">
          {assignment.induction_physician_name ?? 'Unknown physician'}
        </div>
        <div className="font-mono text-[10px] font-semibold text-[#94A3B8]">
          {clock(assignment.assigned_at)}{assignment.ended_at ? ` - ${clock(assignment.ended_at)}` : ' - current'}
        </div>
      </div>
    </div>
  )
}

function CaseDetailPanel({
  code,
  rooms,
  doctors,
  companies,
  hospitalRooms,
  surgeries,
  onClose,
  onSaved,
}: {
  code: string
  rooms: Room[]
  doctors: Surgeon[]
  companies: Company[]
  hospitalRooms: HospitalRoom[]
  surgeries: Surgery[]
  onClose: () => void
  onSaved: () => void
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setEditing(false)
    getCase(code)
      .then((res) => {
        if (alive) setDetail(res.data)
      })
      .catch((err: unknown) => {
        if (alive) setError(apiErrorMessage(err, 'Unable to load case detail'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [code])

  async function handleSaved() {
    setEditing(false)
    onSaved()
    try {
      const res = await getCase(code)
      setDetail(res.data)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Unable to reload case detail'))
    }
  }

  if (editing && detail) {
    return (
      <CaseFormPanel
        mode="edit"
        rooms={rooms}
        doctors={doctors}
        companies={companies}
        hospitalRooms={hospitalRooms}
        surgeries={surgeries}
        detail={detail}
        onCancel={() => setEditing(false)}
        onSaved={handleSaved}
      />
    )
  }

  return (
    <aside className="fixed inset-x-0 bottom-0 top-[var(--app-nav-height)] z-[1200] min-h-0 border-l border-[#D7DEE8] bg-white shadow-[-18px_0_45px_rgba(15,23,42,0.16)] sm:left-auto sm:w-[440px] 2xl:static 2xl:z-auto 2xl:w-auto 2xl:shadow-none">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Case detail</div>
            <div className="mt-1 text-xl font-black text-[#0F172A]">{detail ? displayCode(detail) : code}</div>
          </div>
          <div className="flex gap-1">
            {detail && (
              <button type="button" onClick={() => setEditing(true)} className="h-8 px-3 text-xs font-black uppercase tracking-wide text-[#0F2044] transition hover:bg-[#F8FAFC]">
                Edit
              </button>
            )}
            <button type="button" onClick={onClose} className="h-8 px-3 text-xs font-black uppercase tracking-wide text-[#64748B] transition hover:bg-[#F8FAFC] hover:text-[#0F172A]">
              Close
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm font-semibold text-[#94A3B8]">Loading case metadata...</div>
        ) : error ? (
          <div className="px-5 py-8 text-sm font-semibold text-[#DC2626]">{error}</div>
        ) : detail && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="mb-6 border-b border-[#F1F5F9] pb-4">
              <div className="text-sm font-black text-[#0F172A]">{detail.procedure_name}</div>
              <div className="mt-1 text-xs font-semibold text-[#64748B]">Dr. {detail.doctor.first_name} {detail.doctor.last_name}</div>
            </div>

            {detail.induction_physician_name && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Induction physician</h3>
                <DetailRow label="Assigned at start" value={detail.induction_physician_name} />
              </section>
            )}

            {detail.induction_assignments.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Induction timeline</h3>
                <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
                  {detail.induction_assignments.map((assignment) => (
                    <InductionAssignmentRow key={assignment.id} assignment={assignment} />
                  ))}
                </div>
              </section>
            )}

            {(() => {
              const nurses = [...new Map(
                detail.phase_events
                  .filter((e) => e.triggered_by_nurse_name)
                  .map((e) => [e.triggered_by_nurse_id, e.triggered_by_nurse_name!])
              ).values()]
              return nurses.length > 0 ? (
                <section className="mb-5">
                  <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">
                    {nurses.length === 1 ? 'Nurse' : 'Nurses'}
                  </h3>
                  {nurses.map((name) => (
                    <DetailRow key={name} label="Voice" value={name} />
                  ))}
                </section>
              ) : null
            })()}

            <section className="mb-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Plan</h3>
              <DetailRow label="Room" value={detail.scheduled_room_code} />
              <DetailRow label="Original start" value={dateTime(detail.original_scheduled_start)} />
              <DetailRow label="Planned start" value={dateTime(detail.scheduled_start)} />
              <DetailRow label="Duration" value={`${detail.estimated_duration_min} min`} />
              <DetailRow label="Predicted end" value={dateTime(predictedEnd(detail))} />
            </section>

            <section className="mb-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Case details</h3>
              <DetailRow label="Companies" value={detail.companies.map((company) => company.name).join(', ') || '-'} />
              <DetailRow label="Isolation" value={detail.isolation_required ? 'Required' : 'Not required'} />
              <DetailRow label="Patient room" value={detail.patient_room ?? '-'} />
              {detail.notes && (
                <div className="border-b border-[#F1F5F9] py-2">
                  <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Notes</div>
                  <div className="whitespace-pre-wrap text-sm font-semibold leading-5 text-[#374151]">{detail.notes}</div>
                </div>
              )}
            </section>

            <section className="mb-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Actual timing</h3>
              <DetailRow label="Current phase" value={PHASE_LABEL[detail.current_phase]} />
              <DetailRow label="Actual in" value={dateTime(detail.actual_start_at)} />
              <DetailRow label="Expected end" value={dateTime(detail.expected_end_at)} />
              <DetailRow label="Actual complete" value={dateTime(detail.actual_end_at)} />
            </section>

            {(detail.delay_reason_required || detail.delay_reason) && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Delay</h3>
                <DetailRow
                  label="Reason"
                  value={
                    detail.delay_reason
                      ? DELAY_REASON_LABEL[detail.delay_reason]
                      : detail.delay_reason_required
                        ? 'Awaiting nurse input'
                        : '-'
                  }
                />
                {detail.delay_reason_note && (
                  <DetailRow label="Note" value={detail.delay_reason_note} />
                )}
              </section>
            )}

            {(detail.cancellation_requested || detail.cancellation_reason) && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Cancellation</h3>
                {detail.cancellation_requested_by_nurse_name && (
                  <DetailRow label="Requested by" value={detail.cancellation_requested_by_nurse_name} />
                )}
                {detail.cancellation_requested_at && (
                  <DetailRow label="Requested at" value={dateTime(detail.cancellation_requested_at)} />
                )}
                {detail.cancellation_confirmed_at && (
                  <DetailRow label="Confirmed at" value={dateTime(detail.cancellation_confirmed_at)} />
                )}
                <DetailRow
                  label="Reason"
                  value={detail.cancellation_reason ?? (detail.cancellation_requested ? 'Awaiting admin confirmation' : '-')}
                />
              </section>
            )}

            <section className="mb-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Identifiers</h3>
              <DetailRow label="Voice code" value={detail.voice_case_code ?? '-'} />
              <DetailRow label="Internal ID" value={detail.case_code} />
              <DetailRow label="Voice code day" value={detail.voice_code_day ?? '-'} />
            </section>

            <section className="mb-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Patient</h3>
              <DetailRow label="Patient" value={patientLine(detail)} />
              <DetailRow label="MRN" value={detail.patient?.mrn ?? '-'} />
              <DetailRow label="Age / sex" value={`${detail.patient_age ?? '-'} / ${detail.patient_sex ?? '-'}`} />
            </section>

            <section>
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#B0BAC9]">Events</h3>
              {detail.phase_events.length === 0 ? (
                <div className="border-y border-[#E2E8F0] py-3 text-sm text-[#94A3B8]">No phase events yet.</div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
                  {[...detail.phase_events]
                    .sort((a, b) => new Date(b.actual_time).getTime() - new Date(a.actual_time).getTime())
                    .map((event) => (
                      <PhaseEventRow key={event.id} event={event} />
                    ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm border border-[#D7DEE8] bg-white shadow-2xl">
        <div className="border-b border-[#E2E8F0] px-5 py-4">
          <div className="text-sm font-black text-[#0F172A]">{title}</div>
        </div>
        <div className="px-5 py-4 text-sm font-semibold text-[#475569]">{message}</div>
        <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-9 border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`h-9 px-4 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#0F2044] hover:bg-[#19315F]'}`}
          >
            {pending ? 'Resetting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReasonModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm border border-[#D7DEE8] bg-white shadow-2xl">
        <div className="border-b border-[#E2E8F0] px-5 py-4">
          <div className="text-sm font-black text-[#0F172A]">{title}</div>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3 text-sm font-semibold text-[#475569]">{message}</div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Cancellation reason *</label>
          <textarea
            className="h-24 w-full border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-semibold text-[#0F172A] outline-none transition focus:border-[#0F2044]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why this case is being cancelled..."
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="h-9 bg-[#DC2626] px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-[#B91C1C] disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionMenu({
  c,
  onTransition,
  onDelete,
  onView,
  onConfirmCancellation,
  onRejectCancellation,
  onCancelDirect,
}: {
  c: Case
  onTransition: (c: Case) => void
  onDelete: (c: Case) => void
  onView: (c: Case) => void
  onConfirmCancellation: (c: Case) => void
  onRejectCancellation: (c: Case) => void
  onCancelDirect: (c: Case) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const next = NEXT_PHASE[c.current_phase]

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="flex h-8 w-8 items-center justify-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
        aria-label="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-44 border border-[#D7DEE8] bg-white shadow-lg">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onView(c) }}
            className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F172A] hover:bg-[#F8FAFC]"
          >
            View detail
          </button>
          {next && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onTransition(c) }}
              className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#0F2044] hover:bg-[#F8FAFC]"
            >
              Advance → {next}
            </button>
          )}
          {c.current_phase !== 'CANCELLED' && c.current_phase !== 'COMPLETE' && (
            <>
              <div className="border-t border-[#E2E8F0]" />
              {c.cancellation_requested && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onConfirmCancellation(c) }}
                    className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]"
                  >
                    Confirm Cancellation
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onRejectCancellation(c) }}
                    className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#15803D] hover:bg-[#F0FDF4]"
                  >
                    Reject Cancellation
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(false); onCancelDirect(c) }}
                className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]"
              >
                Cancel Case
              </button>
            </>
          )}
          <div className="border-t border-[#E2E8F0]" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(c) }}
            className="w-full px-4 py-2.5 text-left text-xs font-black uppercase tracking-wide text-[#DC2626] hover:bg-[#FEF2F2]"
          >
            Delete case
          </button>
        </div>
      )}
    </div>
  )
}

function SortHeader({ label, col, sortKey, sortDir, onSort }: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (col: SortKey) => void
}) {
  const active = sortKey === col
  return (
    <button type="button" onClick={() => onSort(col)}
      className="flex items-center gap-1 text-left text-[10px] font-black uppercase tracking-widest text-[#94A3B8] hover:text-[#0F172A] transition-colors">
      {label}
      <span className="text-[8px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </button>
  )
}

export default function AdminCasesPanel({
  cases,
  rooms,
  onRefresh,
}: {
  cases: Case[]
  rooms: Room[]
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState<CaseFilter>('upcoming')
  const [query, setQuery] = useState('')
  const [roomFilter, setRoomFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [transitioning, setTransitioning] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [resetPrompt, setResetPrompt] = useState(false)
  const [resettingCodes, setResettingCodes] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [occupancy, setOccupancy] = useState<ClientRoomOccupancy[]>([])
  const [confirm, setConfirm] = useState<{ type: 'transition' | 'delete' | 'reject-cancellation'; case: Case } | null>(null)
  const [cancelModal, setCancelModal] = useState<{ type: 'confirm' | 'direct'; case: Case } | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('planned')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const scheduleDate = todayInHospitalTimeZone()
  const [scheduledFrom, setScheduledFrom] = useState('')
  const [scheduledTo, setScheduledTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const hasDateTimeRange = Boolean(scheduledFrom || scheduledTo)
  const invalidDateTimeRange = Boolean(scheduledFrom && scheduledTo && scheduledFrom > scheduledTo)

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3_500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
  }

  // Managed surgeon roster — the case form only references these, never creates
  // one implicitly. Include inactive so editing an old case whose surgeon was
  // since disabled still resolves the name.
  const [doctors, setDoctors] = useState<Surgeon[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [hospitalRooms, setHospitalRooms] = useState<HospitalRoom[]>([])
  const [surgeries, setSurgeries] = useState<Surgery[]>([])
  useEffect(() => {
    listDoctors(true).then((res) => setDoctors(res.data)).catch(() => {})
    listCompanies().then((res) => setCompanies(res.data)).catch(() => {})
    listHospitalRooms().then((res) => setHospitalRooms(res.data)).catch(() => {})
    listSurgeries(true).then((res) => setSurgeries(res.data)).catch(() => {})
  }, [cases])

  const stats = useMemo(() => ({
    active: cases.filter((c) => c.current_phase !== 'IDLE' && c.current_phase !== 'COMPLETE').length,
    upcoming: cases.filter((c) => filterCase(c, 'upcoming', scheduleDate)).length,
    completed: cases.filter((c) => c.current_phase === 'COMPLETE').length,
  }), [cases, scheduleDate])

  useEffect(() => {
    listClientRooms().then((res) => setOccupancy(res.data)).catch(() => {})
  }, [cases])

  const nurseByRoom = useMemo(() => {
    const map: Record<string, string> = {}
    for (const o of occupancy) {
      if (o.session) map[o.room_code] = o.session.nurse_name
    }
    return map
  }, [occupancy])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return cases
      .filter((c) => filterCase(c, filter, scheduleDate, hasDateTimeRange))
      .filter((c) => {
        if (!hasDateTimeRange || invalidDateTimeRange) return !invalidDateTimeRange
        const scheduled = scheduledLocalMinute(c)
        return Boolean(scheduled)
          && (!scheduledFrom || scheduled >= scheduledFrom)
          && (!scheduledTo || scheduled <= scheduledTo)
      })
      .filter((c) => roomFilter === 'all' || c.scheduled_room_code === roomFilter)
      .filter((c) => {
        if (!normalized) return true
        return [
          displayCode(c),
          c.case_code,
          c.procedure_name,
          c.doctor.first_name,
          c.doctor.last_name,
          patientLine(c),
        ].join(' ').toLowerCase().includes(normalized)
      })
      .sort((a, b) => {
        let av: number | string = 0
        let bv: number | string = 0
        switch (sortKey) {
          case 'code':       av = displayCode(a); bv = displayCode(b); break
          case 'procedure':  av = a.procedure_name; bv = b.procedure_name; break
          case 'room':       av = a.scheduled_room_code; bv = b.scheduled_room_code; break
          case 'planned':    av = new Date(a.scheduled_start).getTime(); bv = new Date(b.scheduled_start).getTime(); break
          case 'actual_in':  av = a.actual_start_at ? new Date(a.actual_start_at).getTime() : 0; bv = b.actual_start_at ? new Date(b.actual_start_at).getTime() : 0; break
          case 'actual_out': av = a.actual_end_at ? new Date(a.actual_end_at).getTime() : 0; bv = b.actual_end_at ? new Date(b.actual_end_at).getTime() : 0; break
          case 'planned_end':av = a.expected_end_at ? new Date(a.expected_end_at).getTime() : 0; bv = b.expected_end_at ? new Date(b.expected_end_at).getTime() : 0; break
          case 'duration': {
            const ad = a.actual_start_at && a.actual_end_at ? new Date(a.actual_end_at).getTime() - new Date(a.actual_start_at).getTime() : 0
            const bd = b.actual_start_at && b.actual_end_at ? new Date(b.actual_end_at).getTime() - new Date(b.actual_start_at).getTime() : 0
            av = ad; bv = bd; break
          }
          case 'phase':      av = a.current_phase; bv = b.current_phase; break
        }
        const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [cases, filter, hasDateTimeRange, invalidDateTimeRange, query, roomFilter, scheduleDate, scheduledFrom, scheduledTo, sortKey, sortDir])

  useEffect(() => { setPage(1) }, [filter, query, roomFilter, scheduleDate, scheduledFrom, scheduledTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageCases = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  async function confirmTransition() {
    if (!confirm || confirm.type !== 'transition') return
    const c = confirm.case
    const next = NEXT_PHASE[c.current_phase]
    if (!next) return
    setConfirm(null)
    setError('')
    setTransitioning(c.case_code)
    try {
      await transitionCase(c.case_code, next)
      onRefresh()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Transition failed'))
    } finally {
      setTransitioning(null)
    }
  }

  async function confirmDelete() {
    if (!confirm || confirm.type !== 'delete') return
    const c = confirm.case
    setConfirm(null)
    setError('')
    setDeleting(c.case_code)
    try {
      await deleteCase(c.case_code)
      if (selectedCode === c.case_code) setSelectedCode(null)
      onRefresh()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Delete failed'))
    } finally {
      setDeleting(null)
    }
  }

  function handleSaved() {
    setCreating(false)
    onRefresh()
  }

  async function confirmRejectCancellation() {
    if (!confirm || confirm.type !== 'reject-cancellation') return
    const c = confirm.case
    setConfirm(null)
    setError('')
    try {
      await rejectCancellation(c.case_code)
      onRefresh()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Rejecting the cancellation request failed'))
    }
  }

  async function handleCancelSubmit(reason: string) {
    if (!cancelModal) return
    const c = cancelModal.case
    setCancelModal(null)
    setError('')
    try {
      if (cancelModal.type === 'confirm') await confirmCancellation(c.case_code, reason)
      else await cancelCaseDirect(c.case_code, reason)
      onRefresh()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Cancellation failed'))
    }
  }

  async function confirmVoiceCodeReset() {
    setError('')
    setNotice('')
    setResettingCodes(true)
    try {
      const response = await resetVoiceCaseCodes()
      setResetPrompt(false)
      setNotice(`Voice codes reset for ${response.data.length} case(s).`)
      onRefresh()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Voice-code reset failed'))
    } finally {
      setResettingCodes(false)
    }
  }

  async function handleExport() {
    setError('')
    setNotice('')
    if (invalidDateTimeRange) {
      setError('The scheduled From value must be earlier than the To value.')
      return
    }
    if (filtered.length === 0) {
      setError('No cases match the current view filters.')
      return
    }
    setExporting(true)
    try {
      const response = await exportFilteredCases(filtered.map((c) => c.id))
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      const rangeName = hasDateTimeRange
        ? `${scheduledFrom.slice(0, 10) || 'start'}_to_${scheduledTo.slice(0, 10) || 'end'}`
        : 'all-dates'
      link.download = `OR-Cases-${filter}-${rangeName}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      setNotice(`${filtered.length} filtered ${filtered.length === 1 ? 'case' : 'cases'} exported from the ${filter} view.`)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Excel export failed'))
    } finally {
      setExporting(false)
    }
  }

  const filterTabs: { key: CaseFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'upcoming', label: 'Upcoming', count: stats.upcoming },
    { key: 'completed', label: 'Completed', count: stats.completed },
    { key: 'all', label: 'All', count: cases.length },
  ]
  return (
    <div className={`grid h-full min-h-0 ${selectedCode || creating ? '2xl:grid-cols-[minmax(0,1fr)_440px]' : ''}`}>
      <section className="flex min-w-0 min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 border-b border-[#E2E8F0] px-4 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex flex-wrap gap-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`h-9 px-3 text-xs font-black uppercase tracking-wide transition ${
                  filter === tab.key ? 'bg-[#0F2044] text-white' : 'text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                }`}
              >
                {tab.label} <span className="ml-1 opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || filtered.length === 0 || invalidDateTimeRange}
              className="h-9 border border-[#1D4ED8] bg-[#EAF2FF] px-3 text-xs font-black uppercase tracking-wide text-[#1D4ED8] hover:bg-[#DBEAFE] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : `Export (${filtered.length})`}
            </button>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cases"
              className="h-9 min-w-0 flex-1 border border-[#CBD5E1] px-3 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0F2044] sm:w-56 sm:flex-none"
            />
            <select
              value={roomFilter}
              onChange={(event) => setRoomFilter(event.target.value)}
              className="h-9 border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0F2044]"
            >
              <option value="all">All</option>
              {rooms.map((room) => <option key={room.id} value={room.room_code}>{room.room_code}</option>)}
            </select>
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh"
              title="Refresh"
              className="flex h-9 w-9 items-center justify-center border border-[#CBD5E1] text-[#475569] hover:border-[#94A3B8] hover:bg-[#F8FAFC]"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setNotice(''); setResetPrompt(true) }}
              disabled={resettingCodes}
              className="h-9 border border-[#0F2044] px-3 text-xs font-black uppercase tracking-wide text-[#0F2044] hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              RESET
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCode(null)
                setCreating(true)
              }}
              className="h-9 bg-[#0F2044] px-3 text-xs font-black uppercase tracking-wide text-white transition hover:bg-[#19315F]"
            >
              Add
            </button>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-[#D6E4FA] bg-[#F6F9FE] px-4 py-2">
          <div className="mr-1 pb-2 text-[10px] font-black uppercase tracking-widest text-[#475569]">
            Scheduled range · Beirut
          </div>
          <label className="grid gap-1 text-[9px] font-black uppercase tracking-wider text-[#64748B]">
            From
            <input
              type="datetime-local"
              value={scheduledFrom}
              max={scheduledTo || undefined}
              onChange={(event) => setScheduledFrom(event.target.value)}
              className="h-9 border border-[#CBD5E1] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#0F172A] outline-none focus:border-[#0F2044]"
            />
          </label>
          <label className="grid gap-1 text-[9px] font-black uppercase tracking-wider text-[#64748B]">
            To
            <input
              type="datetime-local"
              value={scheduledTo}
              min={scheduledFrom || undefined}
              onChange={(event) => setScheduledTo(event.target.value)}
              className="h-9 border border-[#CBD5E1] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#0F172A] outline-none focus:border-[#0F2044]"
            />
          </label>
          {hasDateTimeRange && (
            <button
              type="button"
              onClick={() => { setScheduledFrom(''); setScheduledTo('') }}
              className="h-9 border border-[#CBD5E1] bg-white px-3 text-[10px] font-black uppercase tracking-wider text-[#475569] hover:bg-[#F8FAFC]"
            >
              Clear range
            </button>
          )}
          <div className={`ml-auto pb-2 text-xs font-bold ${invalidDateTimeRange ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>
            {invalidDateTimeRange
              ? 'From must be earlier than To'
              : `${filtered.length} matching ${filtered.length === 1 ? 'case' : 'cases'} · export includes every match`}
          </div>
        </div>

        {error && <div className="shrink-0 border-b border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2 text-sm font-semibold text-[#B91C1C]">{error}</div>}
        {notice && <div className="shrink-0 border-b border-[#86EFAC] bg-[#F0FDF4] px-4 py-2 text-sm font-semibold text-[#15803D]">{notice}</div>}

        {filter === 'upcoming' && (
          <div className="flex shrink-0 items-center justify-between border-b border-[#D6E4FA] bg-[#F6F9FE] px-4 py-2">
            <div className="text-xs font-bold text-[#334155]">
              {hasDateTimeRange ? 'Showing upcoming cases in the selected range' : "Showing today's upcoming cases"}
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">
              {stats.upcoming} {stats.upcoming === 1 ? 'case' : 'cases'}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid h-full min-h-0 min-w-[900px] grid-rows-[auto_minmax(0,1fr)]">
            {filter === 'completed' ? (
              <div className="grid grid-cols-[120px_minmax(180px,280px)_72px_1fr_1fr_1fr_1fr_90px_40px] border-b border-[#E2E8F0] px-4 py-2">
                <SortHeader label="Case"        col="code"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Procedure"   col="procedure"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Room"        col="room"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Planned"     col="planned"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Actual In"   col="actual_in"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Planned End" col="planned_end" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Actual Out"  col="actual_out"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Duration"    col="duration"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <div />
              </div>
            ) : (
              <div className="grid grid-cols-[120px_minmax(180px,280px)_72px_1fr_1fr_1fr_40px] border-b border-[#E2E8F0] px-4 py-2">
                <SortHeader label="Case"      col="code"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Procedure" col="procedure" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Room"      col="room"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Planned"   col="planned"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Actual In" col="actual_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Phase"     col="phase"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <div />
              </div>
            )}

            <div className="min-h-0 overflow-y-auto">
              {pageCases.length === 0 ? (
                <div className="border-b border-[#E2E8F0] px-3 py-10 text-center text-sm font-semibold text-[#94A3B8]">
                  {filter === 'upcoming'
                    ? 'No upcoming cases scheduled for today.'
                    : 'No cases match the current filters.'}
                </div>
              ) : pageCases.map((c) => {
                const selected = selectedCode === c.case_code
                const nurse = nurseByRoom[c.scheduled_room_code]
                const physician = c.induction_physician_name
                const staffLine = [
                  nurse ? `Nurse: ${nurse}` : null,
                  physician ? `Dr. ${physician}` : null,
                ].filter(Boolean).join(' · ')

                const actualDurMin = c.actual_start_at && c.actual_end_at
                  ? Math.round((new Date(c.actual_end_at).getTime() - new Date(c.actual_start_at).getTime()) / 60_000)
                  : null
                const durDiff = actualDurMin !== null ? actualDurMin - c.estimated_duration_min : null

                if (filter === 'completed') {
                  return (
                    <div
                      key={c.id}
                      className={`grid w-full grid-cols-[120px_minmax(180px,280px)_72px_1fr_1fr_1fr_1fr_90px_40px] items-start border-b border-[#E2E8F0] px-4 py-3 transition ${
                        selected ? 'bg-[#F8FAFC] shadow-[inset_4px_0_0_#0F2044]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <button type="button" onClick={() => { setCreating(false); setSelectedCode(c.case_code) }}
                        className="col-span-7 grid grid-cols-subgrid text-left">
                        <div className="min-w-0 pt-0.5">
                          <div className="truncate text-sm font-black text-[#0F172A]">{c.case_code}</div>
                          {c.voice_case_code && c.voice_case_code !== c.case_code && (
                            <div className="truncate text-[10px] font-semibold text-[#0077B6]">{c.voice_case_code}</div>
                          )}
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <div className="truncate text-sm font-bold text-[#0F172A]">{c.procedure_name}</div>
                          <div className="truncate text-xs font-semibold text-[#64748B]">Dr. {c.doctor.last_name} · {patientLine(c)}</div>
                        </div>
                        <div className="pt-0.5 text-sm font-black text-[#475569]">{c.scheduled_room_code}</div>
                        <div className="pt-0.5 font-mono text-xs font-semibold text-[#475569]">{clock(c.scheduled_start)}</div>
                        <div className="pt-0.5 font-mono text-xs font-semibold text-[#475569]">{clock(c.actual_start_at)}</div>
                        <div className="pt-0.5 font-mono text-xs font-semibold text-[#475569]">{clock(c.actual_end_at)}</div>
                        <div className="pt-0.5">
                          <div className="font-mono text-xs font-black text-[#0F172A]">{actualDurMin !== null ? `${actualDurMin}m` : '-'}</div>
                          {durDiff !== null && (
                            <div className={`text-[10px] font-black ${durDiff > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                              {durDiff > 0 ? `+${durDiff}m` : `${durDiff}m`}
                            </div>
                          )}
                        </div>
                      </button>
                      <ActionMenu c={c}
                        onView={(c) => { setCreating(false); setSelectedCode(c.case_code) }}
                        onTransition={(c) => setConfirm({ type: 'transition', case: c })}
                        onDelete={(c) => setConfirm({ type: 'delete', case: c })}
                        onConfirmCancellation={(c) => setCancelModal({ type: 'confirm', case: c })}
                        onRejectCancellation={(c) => setConfirm({ type: 'reject-cancellation', case: c })}
                        onCancelDirect={(c) => setCancelModal({ type: 'direct', case: c })} />
                    </div>
                  )
                }

                return (
                  <div
                    key={c.id}
                    className={`grid w-full grid-cols-[120px_minmax(180px,280px)_72px_1fr_1fr_1fr_40px] items-start border-b border-[#E2E8F0] px-4 py-3 transition ${
                      selected ? 'bg-[#F8FAFC] shadow-[inset_4px_0_0_#0F2044]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <button type="button" onClick={() => { setCreating(false); setSelectedCode(c.case_code) }}
                      className="col-span-6 grid grid-cols-subgrid text-left">
                      <div className="min-w-0 pt-0.5">
                        <div className="truncate text-sm font-black text-[#0F172A]">{c.case_code}</div>
                        {c.voice_case_code && c.voice_case_code !== c.case_code && (
                          <div className="truncate text-[10px] font-semibold text-[#0077B6]">{c.voice_case_code}</div>
                        )}
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className="truncate text-sm font-bold text-[#0F172A]">{c.procedure_name}</div>
                        <div className="truncate text-xs font-semibold text-[#64748B]">Dr. {c.doctor.last_name} · {patientLine(c)}</div>
                        {staffLine && (
                          <div className="mt-0.5 truncate text-[10px] font-black text-[#0891B2]">{staffLine}</div>
                        )}
                        {c.cancellation_requested && (
                          <div className="mt-0.5 inline-block bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#DC2626]">
                            Cancellation Requested
                          </div>
                        )}
                      </div>
                      <div className="pt-0.5 text-sm font-black text-[#475569]">{c.scheduled_room_code}</div>
                      <div className="pt-0.5 font-mono text-xs font-semibold text-[#475569]">{clock(c.scheduled_start)}</div>
                      <div className="pt-0.5 font-mono text-xs font-semibold text-[#475569]">{clock(c.actual_start_at)}</div>
                      <div className="truncate pt-0.5 text-xs font-black uppercase tracking-wide text-[#475569]">
                        {transitioning === c.case_code || deleting === c.case_code ? '...' : PHASE_LABEL[c.current_phase]}
                      </div>
                    </button>
                    <ActionMenu c={c}
                      onView={(c) => { setCreating(false); setSelectedCode(c.case_code) }}
                      onTransition={(c) => setConfirm({ type: 'transition', case: c })}
                      onDelete={(c) => setConfirm({ type: 'delete', case: c })}
                      onConfirmCancellation={(c) => setCancelModal({ type: 'confirm', case: c })}
                      onRejectCancellation={(c) => setConfirm({ type: 'reject-cancellation', case: c })}
                      onCancelDirect={(c) => setCancelModal({ type: 'direct', case: c })} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[#E2E8F0] px-4 py-3">
          <div className="text-xs font-semibold text-[#64748B]">
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-9 border border-[#CBD5E1] px-3 text-xs font-black uppercase tracking-wide text-[#475569] disabled:opacity-40">
              Prev
            </button>
            <div className="flex h-9 items-center px-2 text-xs font-black text-[#0F172A]">{currentPage} / {totalPages}</div>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="h-9 border border-[#CBD5E1] px-3 text-xs font-black uppercase tracking-wide text-[#475569] disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      </section>

      {creating && (
        <CaseFormPanel
          mode="create"
          rooms={rooms}
          doctors={doctors}
          companies={companies}
          hospitalRooms={hospitalRooms}
          surgeries={surgeries}
          defaultScheduleDate={scheduleDate}
          onCancel={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}
      {selectedCode && !creating && (
        <CaseDetailPanel
          code={selectedCode}
          rooms={rooms}
          doctors={doctors}
          companies={companies}
          hospitalRooms={hospitalRooms}
          surgeries={surgeries}
          onClose={() => setSelectedCode(null)}
          onSaved={onRefresh}
        />
      )}

      {confirm?.type === 'transition' && (
        <ConfirmModal
          title="Advance phase"
          message={`Advance ${displayCode(confirm.case)} from ${PHASE_LABEL[confirm.case.current_phase]} → ${NEXT_PHASE[confirm.case.current_phase]}?`}
          confirmLabel="Advance"
          onConfirm={confirmTransition}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'reject-cancellation' && (
        <ConfirmModal
          title="Reject cancellation"
          message={`Reject the cancellation request for ${displayCode(confirm.case)}? The case unfreezes and continues from ${PHASE_LABEL[confirm.case.current_phase]}.`}
          confirmLabel="Reject Request"
          onConfirm={confirmRejectCancellation}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'delete' && (
        <ConfirmModal
          title="Delete case"
          message={`Delete ${displayCode(confirm.case)} and all related events? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
      {resetPrompt && (
        <ConfirmModal
          title="Reset codes"
          message="Start a new voice-code cycle? Active and upcoming cases will be reassigned from A1. Completed and cancelled cases will keep their historical codes."
          confirmLabel="Reset codes"
          pending={resettingCodes}
          onConfirm={confirmVoiceCodeReset}
          onCancel={() => setResetPrompt(false)}
        />
      )}
      {cancelModal && (
        <ReasonModal
          title={cancelModal.type === 'confirm' ? 'Confirm cancellation' : 'Cancel case'}
          message={`${cancelModal.type === 'confirm' ? 'Confirm the cancellation request for' : 'Cancel'} ${displayCode(cancelModal.case)}? This will mark the case as cancelled and free the room.`}
          confirmLabel={cancelModal.type === 'confirm' ? 'Confirm Cancellation' : 'Cancel Case'}
          onConfirm={handleCancelSubmit}
          onCancel={() => setCancelModal(null)}
        />
      )}
    </div>
  )
}

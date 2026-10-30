import api from './client'

export type PreviewCase = {
  source_row: number
  room_code: string
  scheduled_start: string
  estimated_duration_min: number | null
  procedure_name: string
  doctor_name: string
  patient_mrn: string | null
  patient_age: number | null
  procedure_code: string | null
  note: string | null
}

export type SchedulePreview = {
  filename: string
  schedule_date: string
  cases: PreviewCase[]
  warnings: string[]
}

export type ImportResult = {
  cases_created: number
  filename: string
  status: string
  schedule_date: string
  warnings: string[]
}

const asForm = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return form
}

const formHeaders = { headers: { 'Content-Type': 'multipart/form-data' } }

/** Parse the file and report what would be imported. Writes nothing. */
export const previewSchedule = (file: File) =>
  api.post<SchedulePreview>('/api/v1/import/excel/preview', asForm(file), formHeaders)

export const uploadSchedule = (file: File) =>
  api.post<ImportResult>('/api/v1/import/excel', asForm(file), formHeaders)

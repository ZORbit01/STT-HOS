import api from './client'

export const exportDailySchedule = (date: string) =>
  api.get<Blob>('/api/v1/exports/schedule.xlsx', {
    params: { date },
    responseType: 'blob',
  })

export const exportFilteredCases = (caseIds: string[]) =>
  api.post<Blob>('/api/v1/exports/cases.xlsx', { case_ids: caseIds }, { responseType: 'blob' })

import type { InductionPhysician } from '../../../types'

export type InductionPhysicianPickerProps = {
  physicians: InductionPhysician[]
  selectedPhysicianId: string
  query: string
  loading: boolean
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
}

function physicianName(physician: InductionPhysician) {
  return `Dr. ${physician.first_name} ${physician.last_name}`.trim()
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function fuzzyScore(physician: InductionPhysician, rawQuery: string) {
  const query = normalize(rawQuery)
  if (!query) return 1

  const first = normalize(physician.first_name)
  const last = normalize(physician.last_name)
  const full = `${first}${last}`
  const spaced = normalize(`${physician.first_name} ${physician.last_name}`)
  const initials = normalize(`${physician.first_name[0] ?? ''}${physician.last_name[0] ?? ''}`)

  if (initials === query) return 120
  if (first === query || last === query || spaced === query) return 110
  if (first.startsWith(query) || last.startsWith(query) || spaced.startsWith(query)) return 95
  if (first.includes(query) || last.includes(query) || spaced.includes(query)) return 75

  let index = 0
  let score = 0
  for (const char of full) {
    if (char === query[index]) {
      index += 1
      score += 4
      if (index === query.length) return score
    }
  }
  return 0
}

function rankInductionPhysicians(physicians: InductionPhysician[], query: string) {
  return physicians
    .map((physician, index) => ({ physician, index, score: fuzzyScore(physician, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.physician.last_name.localeCompare(b.physician.last_name) || a.index - b.index)
    .map((item) => item.physician)
}

export function InductionPhysicianPicker({
  physicians,
  selectedPhysicianId,
  query,
  loading,
  onSelect,
}: InductionPhysicianPickerProps) {
  const visiblePhysicians = rankInductionPhysicians(physicians, query)

  if (loading) {
    return <div className="px-6 py-8 text-sm font-semibold text-[#94A3B8]">Loading…</div>
  }
  if (physicians.length === 0) {
    return <div className="px-6 py-8 text-sm font-semibold text-[#DC2626]">No active induction physicians. Ask an admin to add some.</div>
  }
  if (visiblePhysicians.length === 0) {
    return <div className="px-6 py-8 text-sm font-semibold text-[#94A3B8]">No match for "{query}"</div>
  }

  return (
    <>
      {visiblePhysicians.map((physician) => {
        const isSelected = selectedPhysicianId === physician.id
        return (
          <button
            key={physician.id}
            type="button"
            onClick={() => onSelect(physician.id)}
            className={`flex w-full items-center gap-4 border-b border-[#E2E8F0] px-6 py-3.5 text-left transition last:border-b-0 hover:bg-[#F8FAFC] ${
              isSelected ? 'bg-[#F8FAFC] shadow-[inset_4px_0_0_#0F2044]' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-black ${isSelected ? 'text-[#0F2044]' : 'text-[#0F172A]'}`}>
                {physicianName(physician)}
              </div>
              <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                {physician.first_name[0]}{physician.last_name[0]}
              </div>
            </div>
            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
              isSelected ? 'border-[#0F2044] bg-[#0F2044]' : 'border-[#CBD5E1] bg-white'
            }`}>
              {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
            </div>
          </button>
        )
      })}
    </>
  )
}

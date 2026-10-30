import { useState } from 'react'
import { submitDelayReason } from '../../../api/cases'
import { apiErrorMessage } from '../../../api/errors'
import type { Case, DelayReasonCode } from '../../../types'
import { DELAY_REASON_LABEL, DELAY_REASON_OPTIONS } from '../../../utils/delayReason'

interface Props {
  caseItem: Case
  onSubmitted: () => void
}

export function DelayReasonModal({ caseItem, onSubmitted }: Props) {
  const [selected, setSelected] = useState<DelayReasonCode | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!selected) return
    setSubmitting(true)
    setError('')
    try {
      await submitDelayReason(caseItem.case_code, selected, note.trim() || undefined)
      onSubmitted()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Unable to save delay reason'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#0F172A]/35 px-4">
      <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden border border-[#CBD5E1] bg-white shadow-xl">
        <div className="shrink-0 border-b border-[#E2E8F0] px-5 py-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
            {caseItem.voice_case_code ?? caseItem.case_code} started late
          </div>
          <div className="mt-1 text-lg font-black text-[#0F172A]">Why was this case delayed?</div>
          <div className="mt-1 text-xs font-semibold text-[#64748B]">
            Select the main reason this case started later than planned.
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DELAY_REASON_OPTIONS.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setSelected(code)}
                className={`h-11 border px-3 text-left text-xs font-black uppercase tracking-wide transition ${
                  selected === code
                    ? 'border-[#0F2044] bg-[#0F2044] text-white'
                    : 'border-[#CBD5E1] text-[#475569] hover:bg-[#F8FAFC]'
                }`}
              >
                {DELAY_REASON_LABEL[code]}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
              Additional detail (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={256}
              rows={3}
              placeholder="Add any context for the record"
              className="mt-1.5 w-full resize-none border border-[#CBD5E1] px-3 py-2 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0F2044] placeholder:font-semibold placeholder:text-[#94A3B8]"
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-[#E2E8F0] px-5 py-4">
          {error && (
            <div className="mb-3 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>
          )}
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={handleSubmit}
            className="h-9 w-full bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Save reason'}
          </button>
        </div>
      </div>
    </div>
  )
}

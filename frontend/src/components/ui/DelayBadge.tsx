interface Props {
  minutes: number | null
}

export default function DelayBadge({ minutes }: Props) {
  if (minutes === null) return null

  let style: string
  let label: string

  if (minutes <= 0) {
    style = 'bg-[#F0FDF4] text-[#15803D]'
    label = 'On time'
  } else if (minutes < 15) {
    style = 'bg-[#FFFBEB] text-[#B45309]'
    label = `+${Math.round(minutes)} min`
  } else {
    style = 'bg-[#FEF2F2] text-[#DC2626]'
    label = `+${Math.round(minutes)} min`
  }

  return (
    <span className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  )
}

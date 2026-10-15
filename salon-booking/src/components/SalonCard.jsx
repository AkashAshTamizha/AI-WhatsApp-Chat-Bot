import { useEffect, useMemo, useState } from 'react'
import { SALON, SLOTS } from '../config.js'
import { minutesNow, withPastMarked } from '../slots.js'
import TimeSlots from './TimeSlots.jsx'
import WhatsAppButton from './WhatsAppButton.jsx'

function Star() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-amber-400" aria-hidden="true">
      <path d="M10 15.27 16.18 19l-1.64-7.03L20 7.24l-7.19-.61L10 0 7.19 6.63 0 7.24l5.46 4.73L3.82 19z" />
    </svg>
  )
}

function Pin() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-gray-400" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18s6-5.33 6-10a6 6 0 1 0-12 0c0 4.67 6 10 6 10Zm0-7.5A2.5 2.5 0 1 0 10 5.5a2.5 2.5 0 0 0 0 5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export default function SalonCard({ selectedSlot, onSelectSlot }) {
  const [open, setOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  // Slots whose time has already passed (in the salon's time zone) are shown as unavailable,
  // the same rule the WhatsApp bot applies. Re-checked every minute.
  const [now, setNow] = useState(() => minutesNow(SALON.timezone))
  useEffect(() => {
    const t = setInterval(() => setNow(minutesNow(SALON.timezone)), 60_000)
    return () => clearInterval(t)
  }, [])
  const slots = useMemo(() => withPastMarked(SLOTS, now), [now])
  const availableCount = slots.filter((s) => s.available).length

  // If the chosen slot becomes unavailable (time passed), drop the selection.
  useEffect(() => {
    if (selectedSlot && !slots.some((s) => s.time === selectedSlot && s.available)) {
      onSelectSlot(null)
    }
  }, [slots, selectedSlot, onSelectSlot])

  const toggle = () => {
    if (open) onSelectSlot(null)
    setOpen(!open)
  }

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-xl shadow-brand-200/50 ring-1 ring-gray-100">
      <div className="relative h-44 w-full sm:h-56">
        {imageFailed ? (
          <div className="h-full w-full bg-gradient-to-br from-brand-200 to-brand-500" aria-hidden="true" />
        ) : (
          <img
            src={SALON.image}
            alt={`Inside ${SALON.name}`}
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-brand-700 backdrop-blur">
          {SALON.tagline}
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-gray-900">{SALON.name}</h2>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-700">
            <Star />
            {SALON.rating}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{SALON.reviews} reviews</p>

        <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
          <Pin />
          {SALON.address}
        </p>
        <p className="mt-1 text-sm font-medium text-emerald-600">{SALON.hours}</p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {SALON.services.map((s) => (
            <li
              key={s.id || s.name}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {s.name}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={open ? 'time-slots' : undefined}
            className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-brand-600 px-5 text-base font-semibold text-white shadow-md shadow-brand-200 transition hover:bg-brand-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 active:scale-[0.98]"
          >
            {open ? 'Hide Availability' : 'Check Availability'}
          </button>

          {open && (
            <TimeSlots
              id="time-slots"
              slots={slots}
              availableCount={availableCount}
              selected={selectedSlot}
              onSelect={onSelectSlot}
            />
          )}

          <WhatsAppButton />
        </div>
      </div>
    </article>
  )
}

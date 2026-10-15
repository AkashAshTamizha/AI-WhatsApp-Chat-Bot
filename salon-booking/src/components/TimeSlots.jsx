export default function TimeSlots({ id, slots, availableCount, selected, onSelect }) {
  return (
    <section
      id={id}
      aria-label="Available time slots"
      className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Today's time slots</h3>
        <span className="text-xs text-gray-500">{availableCount} available</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {slots.map(({ time, available }) => {
          const isSelected = selected === time
          return (
            <button
              key={time}
              type="button"
              disabled={!available}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : time)}
              className={[
                'h-11 rounded-xl border text-sm font-medium transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
                !available
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through'
                  : isSelected
                    ? 'border-brand-600 bg-brand-600 text-white shadow'
                    : 'border-brand-200 bg-white text-gray-800 hover:border-brand-500 hover:text-brand-700 active:scale-95',
              ].join(' ')}
            >
              {time}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-gray-500" aria-live="polite">
        {availableCount === 0
          ? 'No slots left today. Chat with us on WhatsApp to book another day.'
          : selected
            ? `Selected ${selected}. Chat with us on WhatsApp to book it and pick your service.`
            : 'Pick a time, or chat with us on WhatsApp to book.'}
      </p>
    </section>
  )
}

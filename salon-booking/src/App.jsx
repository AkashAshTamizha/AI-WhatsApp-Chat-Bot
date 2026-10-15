import { useState } from 'react'
import SalonCard from './components/SalonCard.jsx'

export default function App() {
  const [selectedSlot, setSelectedSlot] = useState(null)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-6 sm:max-w-lg sm:py-12">
      <header className="mb-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
          Book your visit
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
          Find a time that suits you
        </h1>
      </header>

      <SalonCard selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} />

      <p className="mt-6 text-center text-xs text-gray-400">
        Bookings and changes are made in our WhatsApp chat
      </p>
    </main>
  )
}

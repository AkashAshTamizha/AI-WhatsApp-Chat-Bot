// Frontend-only configuration. Replace with real values later.

export const SALON = {
  name: 'My Salon',
  tagline: 'Hair · Skin · Nails',
  rating: 4.8,
  reviews: 326,
  address: '12 Residency Road, Chennai',
  hours: 'Open today · 10:00 AM – 8:00 PM',
  image:
    'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
  // Services shown on the website AND offered by the WhatsApp bot (names, prices, durations).
  // These are EXAMPLE values - replace them with your real services and prices.
  services: [
    { id: 'haircut', name: 'Haircut', durationMinutes: 45, price: 500 },
    { id: 'hair-wash', name: 'Hair Wash', durationMinutes: 30, price: 300 },
    { id: 'hair-styling', name: 'Hair Styling', durationMinutes: 60, price: 800 },
    { id: 'hair-coloring', name: 'Hair Coloring', durationMinutes: 120, price: 2000 },
    { id: 'facial', name: 'Facial', durationMinutes: 60, price: 1200 },
    { id: 'manicure', name: 'Manicure', durationMinutes: 45, price: 700 },
    { id: 'pedicure', name: 'Pedicure', durationMinutes: 60, price: 800 },
    { id: 'hair-spa', name: 'Hair Spa', durationMinutes: 90, price: 1500 },
  ],
  currency: 'INR',
  locale: 'en-IN',
  phone: '+91 98765 43210',
  // Optional link sent with the salon's location, e.g. a Google Maps share link.
  // mapUrl: 'https://maps.google.com/?q=...',
  // How many days ahead (including today) customers can book on WhatsApp.
  bookingDays: 7,
  // Appointments must finish by this time (so a 2-hour service is not offered at 7:00 PM).
  closingTime: '8:00 PM',
  // IANA time zone of the salon: decides which of today's slots have already passed.
  timezone: 'Asia/Kolkata',
}

// Daily time-slot template: the same start times repeat on each bookable day.
// `available: false` blocks that start time on every day (e.g. a staff break).
export const SLOTS = [
  { time: '10:00 AM', available: true },
  { time: '10:30 AM', available: true },
  { time: '11:00 AM', available: false },
  { time: '11:30 AM', available: true },
  { time: '12:00 PM', available: true },
  { time: '01:00 PM', available: false },
  { time: '02:00 PM', available: true },
  { time: '03:30 PM', available: true },
  { time: '04:00 PM', available: true },
  { time: '05:30 PM', available: false },
  { time: '06:00 PM', available: true },
  { time: '07:00 PM', available: true },
]

// WhatsApp number in international format, digits only (no +, spaces or dashes).
export const WHATSAPP_NUMBER = '+1 555 140 7992'

// Opening message the customer sends. The bot answers any first message with its welcome and main menu.
export const WHATSAPP_MESSAGE = `Welcome to ${SALON.name} 👋`

/**
 * Dummy salon dataset used for testing the WhatsApp bot.
 * This is the ONLY place salon details, services, prices, opening hours and
 * seeded bookings live. The chatbot never contains any of this - it reads it
 * through the HTTP API in backend/server.js.
 *
 * Replace this module (or the whole backend) with your real system later;
 * as long as the API response shapes stay the same, the bot needs no change.
 */

const salon = {
  id: 'salon-001',
  name: 'Glow & Grace Salon',
  tagline: 'Hair, skin & beauty care for everyone',
  description:
    'A friendly neighbourhood salon offering hair, skin, nail and grooming services by trained stylists.',
  address: {
    line1: '12, Lakeview Road',
    area: 'Adyar',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600020',
    country: 'India',
  },
  phone: '+91 98765 43210',
  email: 'hello@glowandgrace.example',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  rating: 4.7,
  // Appointment grid: bookable start times every `slotMinutes` minutes.
  slotMinutes: 60,
  // Same-day slots starting sooner than this many minutes from now are not offered.
  bookingLeadMinutes: 30,
  // null = closed that day
  hours: {
    mon: { open: '10:00', close: '20:00' },
    tue: { open: '10:00', close: '20:00' },
    wed: { open: '10:00', close: '20:00' },
    thu: { open: '10:00', close: '20:00' },
    fri: { open: '10:00', close: '20:00' },
    sat: { open: '09:00', close: '21:00' },
    sun: null,
  },
};

const services = [
  { id: 'svc-001', name: "Women's Haircut", category: 'Hair', durationMinutes: 45, price: 600, description: 'Wash, cut and blow-dry' },
  { id: 'svc-002', name: "Men's Haircut", category: 'Hair', durationMinutes: 30, price: 300, description: 'Cut and styling' },
  { id: 'svc-003', name: 'Hair Colour (Global)', category: 'Hair', durationMinutes: 120, price: 2500, description: 'Full-head colour with ammonia-free products' },
  { id: 'svc-004', name: 'Hair Spa', category: 'Hair', durationMinutes: 60, price: 1200, description: 'Deep conditioning treatment and scalp massage' },
  { id: 'svc-005', name: 'Beard Trim & Shape', category: 'Grooming', durationMinutes: 30, price: 200, description: 'Trim, shape and hot-towel finish' },
  { id: 'svc-006', name: 'Classic Facial', category: 'Skin', durationMinutes: 60, price: 1500, description: 'Cleansing, exfoliation, massage and mask' },
  { id: 'svc-007', name: 'Manicure', category: 'Nails', durationMinutes: 45, price: 700, description: 'Nail shaping, cuticle care and polish' },
  { id: 'svc-008', name: 'Pedicure', category: 'Nails', durationMinutes: 60, price: 900, description: 'Foot soak, scrub, nail care and polish' },
  { id: 'svc-009', name: 'Full Body Waxing', category: 'Skin', durationMinutes: 90, price: 2200, description: 'Rica wax, full arms, legs and underarms' },
  { id: 'svc-010', name: 'Bridal Makeup', category: 'Makeup', durationMinutes: 120, price: 8000, description: 'Complete bridal look with trial consultation' },
];

/**
 * Seeded bookings, expressed relative to "today" (dayOffset 0 = today) so the
 * test data never goes stale. Each one blocks ceil(duration / slotMinutes)
 * consecutive slots starting at `start`.
 */
const appointments = [
  { id: 'apt-001', dayOffset: 0, start: '16:00', serviceId: 'svc-001', customerName: 'Ananya R', customerPhone: '919800000001', status: 'confirmed' },
  { id: 'apt-002', dayOffset: 0, start: '18:00', serviceId: 'svc-006', customerName: 'Meera S', customerPhone: '919800000002', status: 'confirmed' },
  { id: 'apt-003', dayOffset: 1, start: '10:00', serviceId: 'svc-003', customerName: 'Divya K', customerPhone: '919800000003', status: 'confirmed' },
  { id: 'apt-004', dayOffset: 1, start: '12:00', serviceId: 'svc-002', customerName: 'Karthik V', customerPhone: '919800000004', status: 'confirmed' },
  { id: 'apt-005', dayOffset: 1, start: '15:00', serviceId: 'svc-008', customerName: 'Priya N', customerPhone: '919800000005', status: 'confirmed' },
  { id: 'apt-006', dayOffset: 2, start: '11:00', serviceId: 'svc-010', customerName: 'Lakshmi T', customerPhone: '919800000006', status: 'confirmed' },
  { id: 'apt-007', dayOffset: 2, start: '14:00', serviceId: 'svc-004', customerName: 'Rahul M', customerPhone: '919800000007', status: 'confirmed' },
  { id: 'apt-008', dayOffset: 3, start: '10:00', serviceId: 'svc-009', customerName: 'Sneha P', customerPhone: '919800000008', status: 'confirmed' },
  { id: 'apt-009', dayOffset: 3, start: '13:00', serviceId: 'svc-007', customerName: 'Nisha B', customerPhone: '919800000009', status: 'confirmed' },
  { id: 'apt-010', dayOffset: 4, start: '17:00', serviceId: 'svc-001', customerName: 'Farah A', customerPhone: '919800000010', status: 'confirmed' },
];

module.exports = { salon, services, appointments };

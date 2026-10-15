# WhatsApp workflow implementation (latest change)

The bot now follows the "My Salon" workflow: website button -> welcome + main menu -> View Services /
Book / Reschedule / Contact. See `whatsapp-bot/README.md` section 6 for the flow and section 5 for the API.

- **Chat flow rewritten** (`chatController.js`): numbered replies, services list with duration and price,
  booking (service -> date -> time -> confirm -> Booking ID), rescheduling by Booking ID, contact details.
  The old "ask for your name" step is gone; the WhatsApp profile name is used.
- **Backend gained bookings**: `POST /appointments`, `GET /appointments/:id`, `PATCH /appointments/:id`,
  a JSON booking store (`backend/bookingStore.js`) and IDs like `MS-10001`.
- **Availability is now per service and per day**: slots repeat for `SALON.bookingDays` days, a booking blocks
  every overlapping start time (using the service's duration), and nothing is offered that would end after
  `SALON.closingTime`.
- **Privacy**: a Booking ID only works from the WhatsApp number that made the booking.
- **Website**: salon renamed "My Salon"; services now carry price/duration (example values - replace them);
  the button reads "💬 Chat with My Salon on WhatsApp" and opens WhatsApp with "Welcome to My Salon 👋".
  The website no longer appends a chosen slot to that message (the bot books inside WhatsApp instead).
- **Tests**: 30 tests (flow, booking rules, concurrency, security, pagination, mock source).

The sections below describe the earlier bug-fix round; items about the old name/slot-list flow (10-13)
no longer apply to the new flow.

# Bugs and issues fixed

Both projects were reviewed file by file, built, tested and booted. The original 12 tests still pass;
10 new tests were added (22 total). `salon-booking` builds cleanly with `npm run build`.

## whatsapp-bot

### Security / reliability
1. **Signature check could be skipped.** It ran inside the JSON parser, which does not run for an empty or
   non-JSON body, so such a POST bypassed it. It is now a dedicated middleware on `POST /webhook` that
   always runs on the raw body, and it fails closed (no secret / no header / wrong length / wrong HMAC => 401).
2. **Every error became a 401.** A malformed JSON body now returns 400, an oversized one 413, anything else 500.
3. **Only the first message in a webhook was read** (`entry[0].changes[0]`). All entries, changes and
   messages are now processed, each with its own contact.
4. **Duplicate processing.** Meta re-delivers webhooks; the same message id was answered twice. Ids are now
   remembered for 15 minutes.
5. **Race condition.** Two quick messages ("hi", "Arjun") ran concurrently on the same stale session, giving a
   double greeting or a lost name. Messages from one customer are now queued and handled in order.
6. **Server started with missing credentials** and only printed a warning, then failed later with
   "Bearer undefined". It now refuses to start and lists exactly what is missing.
7. **Unhelpful API errors.** Meta's real error text is now surfaced instead of "status code 400".
8. `BACKEND_BASE_URL` had no default (axios failed with a confusing error); it now defaults to
   `http://localhost:4000`.
9. `server.js` now exports `app` (testable) and only listens when run directly; unhandled rejections are logged.

### Chat flow
10. **Only the first 10 slots were reachable.** WhatsApp lists hold 10 rows, so with more than 10 open slots
    (the mock data, or any real backend) the rest could never be seen. Reply *more* now pages through them.
11. **Empty row descriptions** were sent to WhatsApp, which rejects them. They are now omitted.
12. **"undefined" in messages** when the backend lacked a salon name or slot label. Safe fallbacks added.
13. **Names containing `*` `_` `~`** broke the bold/italic formatting of replies. Those characters are stripped.
14. **`aiService.js` was dead code** with intents from a different product (PRODUCTS, OFFERS). It now has
    salon intents and is used as an optional fallback for free text (no-op without `ANTHROPIC_API_KEY`).
15. WhatsApp length limits (text 4096, list header 60, body 1024, button 20) are enforced when sending.
16. Unused `body-parser` dependency removed; `npm test` runs all test files.

### Backend
17. **Impossible dates were accepted** (`2026-02-31` rolled over to 3 March). They are now rejected with 400.
18. Mock data source: a missing `bookingLeadMinutes` produced `NaN` and stopped past slots being filtered.

## salon-booking (website)
19. **The chosen time slot was thrown away.** The page said "Tap Chat on WhatsApp to continue" but the link
    never contained the slot. It is now added to the opening WhatsApp message.
20. **Past slots looked bookable** on the website while the bot hid them. The website now disables slots whose
    time has passed (in the salon's time zone, re-checked every minute) and says so when none are left.
21. Broken hero image left an empty box; there is now a gradient fallback.
22. No favicon (a 404 on every load) and no meta description; added. `.gitignore` added.
23. WhatsApp number is sanitised to digits only so a stray `+` or space can't break the `wa.me` link.
24. `aria-controls` pointed at an element that did not exist while the panel was closed.

## Not changed (needs your decision)
- Sessions are in memory (lost on restart, one instance only). Use Redis for production.
- A booking is only "noted" in the chat; nothing is written back to a calendar/database.
- The website's slots are a static list for "today"; real availability needs a real backend.

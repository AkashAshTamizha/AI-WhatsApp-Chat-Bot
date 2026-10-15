# WhatsApp Booking Chatbot (Meta Cloud API + backend API)

The bot answers the website's WhatsApp button with a numbered main menu (View Services, Book an
Appointment, Reschedule an Appointment, Contact Salon), takes bookings, hands out Booking IDs
(e.g. `MS-10001`) and reschedules them. **Nothing about the business is hard-coded in the bot** - name,
services, prices, durations, hours, phone, slots, currency and locale all come from backend APIs, made
only from `src/services/backendService.js`.

The bundled `backend/` serves **your booking website's own data** (read live from its `src/config.js`)
and stores the bookings the bot makes, so the chatbot always describes what the website shows.
The old dummy dataset is still available with `DATA_SOURCE=mock` (browsing only, no bookings).

## 1. How it fits together

```
WhatsApp user
     │
     ▼
Meta WhatsApp Cloud API  ──webhook──▶  This Node.js server
     ▲                                     │
     │ send message                       ▼
     └──────────────────────────  backendService.js
                                           │
                                           ▼
                              Backend (backend/)
                              reads the website's src/config.js
                              (details, services, time slots)
```

The bot never stores business data - it fetches it on demand, so slots and
prices are always current.

## 2. Meta APIs and setup you need

1. **Meta Business Account + App** (developers.facebook.com) with the
   **WhatsApp** product added.
2. **WhatsApp Cloud API** — this is the messaging API itself. From the app's
   WhatsApp > API Setup page you get:
   - `WHATSAPP_PHONE_NUMBER_ID` — the sending number's ID
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` (WABA ID)
   - a temporary token (swap for a **permanent System User token** with
     `whatsapp_business_messaging` + `whatsapp_business_management`
     permissions before going live — Business Settings > System Users)
3. **Webhook subscription** — under WhatsApp > Configuration:
   - Callback URL: `https://your-domain.com/webhook`
   - Verify token: any string you choose, put it in `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field (this delivers inbound texts, button
     replies, list replies, media, and delivery/read statuses)
4. **App Secret** (App Dashboard > Settings > Basic) → `META_APP_SECRET`,
   used to verify every webhook call is genuinely from Meta.
5. **Graph API** (`https://graph.facebook.com/vXX.X/...`) — the underlying
   REST API the Cloud API endpoints live on; used for `/messages` (send),
   media, and template management.
6. **Message Templates** (optional but usually required in production) —
   if you want to message a user **first**, outside the 24-hour customer
   service window (e.g. "your order shipped"), it must use a pre-approved
   template created under WhatsApp > Message Templates. Free-flowing replies
   inside 24 hours of the user's last message don't need templates.
7. **WhatsApp Business Platform review / display name approval** — required
   before you can message the general public in production (test numbers
   work immediately for up to 5 recipients).

## 3. Environment variables

See `.env.example` for the full list with comments. Summary:

| Variable | Purpose |
|---|---|
| `META_GRAPH_VERSION` | Graph API version, e.g. `v21.0` |
| `WHATSAPP_TOKEN` | Permanent access token for sending messages |
| `WHATSAPP_PHONE_NUMBER_ID` | Your WA sending number's ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID |
| `WHATSAPP_VERIFY_TOKEN` | Shared secret for the webhook GET handshake |
| `META_APP_SECRET` | Used to verify the `X-Hub-Signature-256` header |
| `BACKEND_BASE_URL` | Base URL of the backend (`http://localhost:4000` for the bundled one) |
| `BACKEND_API_KEY` | Auth token your backend expects (if any) |
| `BACKEND_*_PATH` | Override any endpoint path without touching code (`SALON`, `SERVICES`, `SLOTS`, `SLOT_BY_ID`, `AVAILABILITY`, `APPOINTMENTS`) |
| `BOOKINGS_FILE` | Bundled backend only: where bookings are saved (default `backend/data/bookings.json`, git-ignored) |
| `MOCK_BACKEND_PORT` | Port of the bundled backend (default 4000) |
| `DATA_SOURCE` | Bundled backend only: `website` (default) or `mock` |
| `WEBSITE_CONFIG_PATH` | Path to the website's `src/config.js` (default `../salon-booking/src/config.js`) |
| `BUSINESS_TIMEZONE` | IANA time zone of the business, e.g. `Asia/Kolkata`. **Set it on any hosted server** - the website config has none |
| `BUSINESS_LOCALE` / `BUSINESS_CURRENCY` / `BOOKING_LEAD_MINUTES` | Optional; used only if the website config doesn't say |
| `ANTHROPIC_API_KEY` | Optional. Lets the bot understand free-text messages the keyword rules miss (see `src/services/aiService.js`). Leave blank to run on keywords only |
| `ANTHROPIC_MODEL` | Optional model override for the AI layer |
| `PORT` | Local server port |

## 4. Node.js packages used

| Package | Why |
|---|---|
| `express` | HTTP server + webhook routes (its JSON parser keeps the raw body for signature checks) |
| `axios` | Calls to Graph API and to your backend |
| `dotenv` | Loads `.env` |
| `node-cache` | In-memory per-user conversation state (swap for `ioredis` in multi-instance production) |
| `@anthropic-ai/sdk` | Optional free-text intent classification |
| `winston` | Structured logging (wire in as needed) |

Install with:
```bash
npm install
```

## 5. Backend (`backend/`)

| File | Purpose |
|---|---|
| `backend/server.js` | Express API (unchanged endpoints and response shapes) |
| `backend/sources/website.js` | **Default.** Reads the website's `src/config.js` on every request and maps it to the API; creates and reschedules bookings |
| `backend/bookingStore.js` | Saves bookings (and the Booking ID counter) to a JSON file so they survive restarts |
| `backend/sources/mock.js` + `data.js` + `availability.js` | The original dummy dataset, selectable with `DATA_SOURCE=mock` |

### What the website provides and how it maps

The website has no API; its data is a static frontend file, so the backend reads that file.

| Website (`src/config.js`) | API | Bot shows |
|---|---|---|
| `SALON.name`, `tagline` | `GET /salon` | Welcome message |
| `SALON.phone`, `address`, `hours`, `mapUrl`, `rating`, `reviews` | `GET /salon` | **Contact Salon** |
| `SALON.services` (`name`; objects may carry `id`, `price`, `durationMinutes`, `description`) | `GET /services` | Services lists, booking |
| `SALON.currency`, `locale` | `GET /services`, `/salon` | Price formatting (`₹500`) |
| `SLOTS` (`time`, `available`) | `GET /slots`, `/slots/:id`, `/availability` | A **daily template**: the same start times repeat for each of the next `SALON.bookingDays` days (default 7) |
| `SALON.closingTime` | (slot rules) | A service is only offered where it finishes by closing time |

How availability is decided for a service: a start time is offered unless the website marks it
`available: false`, it has already passed (today only, in the business time zone), the service
(its `durationMinutes`) would overlap an existing booking, or it would end after `closingTime`.
Booking IDs are `<initials of the salon name>-<number>` (override the prefix with `SALON.bookingPrefix`).

| Endpoint | Returns |
|---|---|
| `GET /salon` | name, tagline, phone, rating, reviews, address, `hoursLabel`, `mapUrl`, timezone, locale, currency (each only if known) |
| `GET /services` (`?category=`) | `{ currency, locale, items: [{ id, name, ...optional price/durationMinutes/description }] }` |
| `GET /services/:id` | One service |
| `GET /slots` | Flat list of slots. Params: `date`, `from`+`days`, `serviceId`, `exclude` (a booking ID to ignore), `available=false`, `limit` |
| `GET /slots/:id` | One slot with live `available` + `reason` (`serviceId`, `exclude` as above) |
| `GET /availability` | Per-day summary (`dateLabel`, `relative` "Today"/"Tomorrow", `availableSlots`) |
| `POST /appointments` | Body `{ serviceId, slotId, customerName?, customerPhone }` -> `201` booking with its ID; `404` unknown service/slot; `409` time no longer free |
| `GET /appointments/:id` | One booking. With `?phone=` it is only returned to the number that made it (otherwise `404`) |
| `PATCH /appointments/:id` | Body `{ slotId, customerPhone? }` -> the moved booking; `404` / `409` as above |
| `GET /appointments` | Bookings (`?phone=` filters to one customer) |

The mock source answers the three booking endpoints with `501`.

```bash
npm run backend
curl localhost:4000/salon
curl "localhost:4000/slots?limit=5"
DATA_SOURCE=mock npm run backend   # the original dummy salon
```

To use a real system later, keep the same response shapes (or adjust the mapping in
`backendService.js`) and point `BACKEND_BASE_URL` at it. In production, prefer having the website
expose its data through a real endpoint over reading its source file from disk.

## 6. Conversation flow implemented

Customers reply with option numbers (`1`, `1.` and `1️⃣` all work; common keywords like "book", "prices",
"reschedule", "address" work in the main menu). `menu`, `hi` or `0` returns to the main menu from anywhere.

```
Website button -> WhatsApp opens with "Welcome to <salon> 👋"
      ↓
Main menu (sent for ANY first message)
  1 View Services  -> list (name — duration — price) -> reply a number -> details -> 1 Book this service
  2 Book           -> service -> date -> time slot -> confirm (1 Confirm / 2 Change Time / 3 Cancel)
                      -> booking created -> "✅ Appointment Confirmed!" with Booking ID
  3 Reschedule     -> enter Booking ID -> "We found your appointment" + new times on the same day
                      (reply "date" to pick another day) -> "🔄 Appointment Rescheduled Successfully!"
  4 Contact Salon  -> phone, location, hours
```

Details worth knowing:

- **Only the number that made a booking can see or reschedule it.** A Booking ID typed from another
  WhatsApp number gets the same "couldn't find" reply as a wrong ID.
- Every chosen time is re-checked live before it is shown for confirmation, and again when the booking
  is created; if someone else took it meanwhile the customer is told and shown fresh times.
- More than 10 open times in a day: the list shows 10 and "Reply *more*" shows the next ones.
- The booking's customer name is the WhatsApp profile name (the bot doesn't ask for one).
- Messages sent while the backend is down get a friendly retry message and the customer stays on the same step.
- With `ANTHROPIC_API_KEY` set, free text the keywords miss in the main menu is classified into one of the
  four menu options (it never writes replies or invents data).
- Not implemented: cancelling an existing booking, reminders, and calendar/database sync.

## 7. Running it

```bash
cp .env.example .env   # fill in WhatsApp values; check BUSINESS_TIMEZONE and WEBSITE_CONFIG_PATH
npm install
npm run backend         # terminal 1: backend on :4000, serving the website's data
npm run dev             # terminal 2: the WhatsApp bot on :3000
npm test                # flow, booking-rules, webhook-security and pagination tests (no WhatsApp credentials needed)
```

Expose it publicly for Meta's webhook (e.g. `ngrok http 3000` while
developing), then register `https://<public-url>/webhook` in the Meta App
Dashboard as described in section 2.

## 8. Production notes

- The server refuses to start until `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` and
  `META_APP_SECRET` are set. Every webhook POST must carry a valid `X-Hub-Signature-256`.
- Duplicate webhook deliveries are ignored (by message id), and each customer's messages are handled in order.
- Replace `node-cache` (sessions) with Redis, and the JSON booking store with a real database, if you run more than one instance.
- Back up `backend/data/bookings.json` (or move bookings to a database): it is the only record of who booked what.
- Add retry/backoff around backend calls if your APIs can be slow.
- Log every inbound/outbound message (via `winston`) for auditing.
- Handle WhatsApp rate limits (Cloud API throttles by messaging tier) —
  back off and queue if you send bulk outbound messages.
- Rotate `WHATSAPP_TOKEN` before the temporary token expires; use the
  permanent System User token for production.

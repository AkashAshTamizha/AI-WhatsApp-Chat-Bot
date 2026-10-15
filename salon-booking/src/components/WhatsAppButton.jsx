import { SALON, WHATSAPP_MESSAGE, WHATSAPP_NUMBER } from '../config.js'

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.95L2 22l5.2-1.5A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.08.89.9-3-.2-.31a8.2 8.2 0 1 1 6.88 3.75Zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8-.22-.08-.39-.12-.55.12-.16.25-.63.8-.78.96-.14.16-.29.18-.53.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.22-1.46-1.37-1.7-.14-.25-.02-.38.1-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.2 3.7.59.26 1.05.41 1.4.52.59.19 1.13.16 1.55.1.47-.07 1.46-.6 1.66-1.17.2-.58.2-1.07.14-1.17-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  )
}

// Opens WhatsApp with the salon's welcome message; the bot replies with its main menu
// (services, booking, rescheduling, contact).
export default function WhatsAppButton() {
  const number = String(WHATSAPP_NUMBER).replace(/\D/g, '') // wa.me needs digits only
  const href = `https://wa.me/${number}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 text-base font-semibold text-white shadow-md shadow-emerald-200 transition hover:bg-[#1ebe5b] focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 active:scale-[0.98]"
    >
      <WhatsAppIcon />
      💬 Chat with {SALON.name} on WhatsApp
    </a>
  )
}

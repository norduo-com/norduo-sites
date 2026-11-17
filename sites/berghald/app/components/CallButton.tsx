/** Sticky call button, shown on mobile only. */
export function CallButton({ phone }: { phone: string }) {
  const tel = phone.replace(/\s+/g, '')
  return (
    <a
      href={`tel:+354${tel}`}
      className="bg-neutral-900 px-6 py-4 font-medium text-white shadow-lg md:hidden fixed right-g bottom-g rounded-full"
    >
      Hringdu í {phone}
    </a>
  )
}

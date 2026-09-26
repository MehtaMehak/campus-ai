/* ============================================================
   Shared icon set (inline SVG, no extra packages needed)
   Every icon is drawn with thin strokes inside a 24x24 box.
   ============================================================ */

const iconPaths = {
  cap: (
    <>
      <path d="M22 9 12 4 2 9l10 5 10-5Z" />
      <path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />
      <path d="M22 9v6" />
    </>
  ),
  book: (
    <>
      <path d="M12 7c-2-2-4.5-3-8-3v13c3.5 0 6 1 8 3 2-2 4.5-3 8-3V4c-3.5 0-6 1-8 3Z" />
      <path d="M12 7v13" />
    </>
  ),
  note: (
    <>
      <path d="M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </>
  ),
  pencil: (
    <>
      <path d="M17 3.5a2.1 2.1 0 0 1 3 3L7.5 19 3 20l1-4.5L17 3.5Z" />
      <path d="m14.5 6 3 3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
      <path d="M3 12.5 12 17.5l9-5" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.3 12.4 2.4 2.4 5-5.4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 8l1.4 1.4L13 7" />
      <path d="M9 13l1.4 1.4L13 12" />
      <path d="M9 18h6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M6 7l1.2 13a1.8 1.8 0 0 0 1.8 1.6h6a1.8 1.8 0 0 0 1.8-1.6L18 7" />
      <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </>
  ),
}

// Renders an icon by name. Colour/size come from CSS (.icon, .icon--lg…)
export function Icon({ name, className = '' }) {
  return (
    <span className={`icon ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconPaths[name]}
      </svg>
    </span>
  )
}
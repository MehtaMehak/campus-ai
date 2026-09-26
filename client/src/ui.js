/* ============================================================
   Shared UI utilities and constants.
   Pure logic only — no components, no hooks.

   These helpers used to be copy-pasted across the Courses /
   Notes / Assignments / Study Planner pages (and the App shell).
   They now live here so every page uses the exact same logic.
   ============================================================ */

// Muted, academic tints used for course chips and cards everywhere.
// Courses are cycled by id, so every page shows the same colours.
export const ACCENTS = [
  { color: '#4a6a48', wash: '#eef2ea', line: '#d6e0cf' }, // sage
  { color: '#a05a38', wash: '#f7efe7', line: '#e7d3c3' }, // clay
  { color: '#8a7a34', wash: '#f6f3e3', line: '#e4dcb9' }, // ochre
  { color: '#3f5b72', wash: '#eef1f4', line: '#d3dce4' }, // slate
  { color: '#6b5f76', wash: '#f3f0f6', line: '#ddd6e3' }, // heather
  { color: '#75584a', wash: '#f4eee9', line: '#e0d3c9' }, // umber
]

// Quiet tones for the status pill (sage = done, ochre = pending, slate = other)
export const STATUS_TONES = {
  Completed: { color: '#4a6a48', wash: '#eef2ea', line: '#d6e0cf' },
  Pending: { color: '#8a7a34', wash: '#f6f3e3', line: '#e4dcb9' },
}

export function statusTone(status) {
  return (
    STATUS_TONES[status] || { color: '#3f5b72', wash: '#eef1f4', line: '#d3dce4' }
  )
}

// Subtle warm tones for the priority pill (clay = high, ochre = medium, sage = low)
export const PRIORITY_TONES = {
  High: { color: '#a05a38', wash: '#f7efe7', line: '#e7d3c3' },
  Medium: { color: '#8a7a34', wash: '#f6f3e3', line: '#e4dcb9' },
  Low: { color: '#4a6a48', wash: '#eef2ea', line: '#d6e0cf' },
}

export function priorityTone(priority) {
  return PRIORITY_TONES[priority] || PRIORITY_TONES.Medium
}

// Turn the database timestamp into something human, e.g. "24 Sep 2026"
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Local calendar-day key for a date, e.g. "2026-09-24". Built from the LOCAL
// date parts so a date never slips by a day because of UTC conversion.
export function dateKey(value) {
  if (!value) return null
  // Already a bare "YYYY-MM-DD" string → it's a calendar day, keep it as-is.
  if (typeof value === 'string') {
    const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`
  }
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// Read the optional course filter from the page hash (#notes?course=3 → 3).
// Returns a positive integer course id, or null when the hash has none (the
// plain #notes / #assignments / #planner views keep working exactly as before).
export function courseIdFromHash() {
  const raw = window.location.hash.replace(/^#/, '')
  const query = raw.split('?')[1] || ''
  const value = new URLSearchParams(query).get('course')
  const id = Number(value)
  return value && Number.isInteger(id) && id > 0 ? id : null
}
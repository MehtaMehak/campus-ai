import { useEffect, useRef, useState } from 'react'
import { ACCENTS, courseIdFromHash } from './ui.js'

/**
 * Shared course-context filter read from the page hash (#notes?course=3 → 3).
 *
 * Owns only the shared filter behavior:
 *   - reading the filter id from the hash on mount (deep links),
 *   - keeping it in sync while the page stays mounted (header nav, the
 *     banner's "clear" link, browser back/forward) via a hashchange listener,
 *   - resolving the selected course + accent from the catalog for the banner,
 *   - a `ready` flag (the page's !loading) used to gate the banner so the
 *     course name never flashes as "Course 1" before the catalog is fetched,
 *   - a consistent "clear filter" target (the page's plain #view hash).
 *
 * The pages keep owning their own data fetching (their records + the course
 * catalog), CRUD, error/empty states and form state. `onFilterChange` lets a
 * page mirror filter changes into its own state (e.g. the create form's
 * default course) without re-registering a second hashchange listener.
 */
export function useCourseFilter({ courses, loading, baseView, onFilterChange }) {
  // Keep the latest callback available to the hashchange listener without
  // re-registering it on every render.
  const onFilterChangeRef = useRef(onFilterChange)
  useEffect(() => {
    onFilterChangeRef.current = onFilterChange
  }, [onFilterChange])

  // null = the normal "all my notes/assignments/tasks" view.
  const [courseFilterId, setCourseFilterId] = useState(() => courseIdFromHash())

  useEffect(() => {
    function syncFilterFromHash() {
      const id = courseIdFromHash()
      setCourseFilterId(id)
      onFilterChangeRef.current?.(id)
    }
    window.addEventListener('hashchange', syncFilterFromHash)
    return () => window.removeEventListener('hashchange', syncFilterFromHash)
  }, [])

  // The course behind the active filter (for the banner chip + label).
  // The catalog arrives with the page's own data load, so `ready` (the page's
  // !loading) gates the banner — no "Course 1" flash. Unknown ids keep the
  // "#id" / "Course id" fallbacks the banner has always used.
  const filterCourse =
    courses.find((course) => course.id === courseFilterId) || null
  const filterAccent = courseFilterId
    ? ACCENTS[courseFilterId % ACCENTS.length]
    : null

  // Consistent "clear filter" action for the banner: back to the plain view.
  const clearHref = `#${baseView}`

  return {
    courseFilterId,
    filterCourse,
    filterAccent,
    ready: !loading,
    clearHref,
  }
}
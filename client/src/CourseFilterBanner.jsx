import { Icon } from './Icon.jsx'

// The course-context banner shown when a Notes / Assignments / Study Planner
// page is opened with a course filter (#page?course=ID): the course's chip,
// a "Page · Course name" label, and the clear-filter action.
//
// Pure presentation — the pages still own the filter state, the data, the
// {!loading && courseFilterId} gate (so the real course name is always ready)
// and the accent choice. Each page passes its own item label ("Notes",
// "Assignments", "Study Planner") plus the clear link's target/text.
export default function CourseFilterBanner({
  itemLabel,
  course,
  courseId,
  accent,
  clearHref,
  clearText,
  clearAriaLabel,
}) {
  return (
    <div className="course-filter">
      <span
        className="course-chip"
        style={{
          color: accent.color,
          backgroundColor: accent.wash,
          borderColor: accent.line,
        }}
      >
        {course ? course.code : `#${courseId}`}
      </span>
      <span className="course-filter-label">
        {itemLabel} · {course ? course.name : `Course ${courseId}`}
      </span>
      <a
        href={clearHref}
        className="btn-link course-filter-clear"
        aria-label={clearAriaLabel}
      >
        {clearText}
        <Icon name="arrow" className="icon--sm" aria-hidden="true" />
      </a>
    </div>
  )
}
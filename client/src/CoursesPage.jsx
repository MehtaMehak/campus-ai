import { useEffect, useState } from 'react'
import {
  fetchAssignments,
  fetchCourses,
  fetchNotes,
  fetchStudyTasks,
  getResources,
} from './api.js'
import { Icon } from './Icon.jsx'
import { ACCENTS, formatDate, priorityTone, statusTone } from './ui.js'

// "1 note", "2 notes" — tiny helper for the card counters
function countText(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The detail view for one course. It receives the course plus ALL of the
// user's notes / assignments / study tasks / resources and filters them by
// course_id here — so no extra API calls are needed.
function CourseDetail({
  course,
  notes,
  assignments,
  studyTasks,
  resources,
  onBack,
}) {
  const accent = ACCENTS[course.id % ACCENTS.length]

  // Only the records that belong to this course
  const courseNotes = notes.filter((note) => note.course_id === course.id)
  const courseAssignments = assignments.filter(
    (a) => a.course_id === course.id
  )
  const courseTasks = studyTasks.filter((task) => task.course_id === course.id)
  const courseResources = resources.filter(
    (resource) => resource.course_id === course.id
  )

  return (
    <div className="course-detail">
      {/* -------- Back to the course list -------- */}
      <button type="button" className="btn-link course-detail-back" onClick={onBack}>
        <Icon name="arrow" className="icon--sm course-back-icon" aria-hidden="true" />
        Back to courses
      </button>

      {/* -------- Course header -------- */}
      <div className="course-detail-head">
        <span
          className="course-mark"
          style={{
            color: accent.color,
            backgroundColor: accent.wash,
            borderColor: accent.line,
          }}
        >
          {course.code}
        </span>
        <div className="course-detail-head-copy">
          <p className="kicker">Course</p>
          <h2 className="course-title">{course.name}</h2>
          <p className="course-meta">
            Code · {course.code} · Added {formatDate(course.created_at)}
          </p>
        </div>
      </div>

      {/* -------- Counts for this course -------- */}
      <div className="course-detail-stats" aria-label="Study items for this course">
        <span className="tag">{countText(courseNotes.length, 'note')}</span>
        <span className="tag">
          {countText(courseAssignments.length, 'assignment')}
        </span>
        <span className="tag">{countText(courseTasks.length, 'study task')}</span>
      </div>

      {/* -------- Notes -------- */}
      <section className="section course-detail-section">
        <div className="section-head">
          <p className="kicker">Notes</p>
          <h2>Notes</h2>
          <span className="tag">{courseNotes.length} notes</span>
        </div>
        {courseNotes.length === 0 ? (
          <p className="status-message">No notes for this course yet.</p>
        ) : (
          <div className="note-grid">
            {courseNotes.map((note) => (
              <article className="note-card" key={note.id}>
                <div className="note-card-top">
                  <span className="note-index">
                    {String(note.id).padStart(2, '0')}
                  </span>
                  <span className="note-date">{formatDate(note.created_at)}</span>
                </div>
                <h3 className="note-title">{note.title}</h3>
                <p className="note-preview">{note.content}</p>
              </article>
            ))}
          </div>
        )}
        {/* Hash anchor carrying the course → the Notes page shows only this
            course's notes via the ?course=ID query (see NotesPage) */}
        <a
          href={`#notes?course=${course.id}`}
          className="btn-link course-detail-action"
        >
          View all notes
          <Icon name="arrow" className="icon--sm" aria-hidden="true" />
        </a>
      </section>

      {/* -------- Assignments -------- */}
      <section className="section course-detail-section">
        <div className="section-head">
          <p className="kicker">Assignments</p>
          <h2>Assignments</h2>
          <span className="tag">{courseAssignments.length} assignments</span>
        </div>
        {courseAssignments.length === 0 ? (
          <p className="status-message">No assignments for this course yet.</p>
        ) : (
          <div className="assignment-grid">
            {courseAssignments.map((assignment) => {
              const tone = statusTone(assignment.status)
              return (
                <article className="assignment-card" key={assignment.id}>
                  <div className="assignment-card-top">
                    <span className="assignment-index">
                      {String(assignment.id).padStart(2, '0')}
                    </span>
                    <span
                      className={`assignment-due${
                        assignment.due_date ? '' : ' assignment-due--none'
                      }`}
                    >
                      {assignment.due_date
                        ? `Due ${formatDate(assignment.due_date)}`
                        : 'No due date'}
                    </span>
                  </div>
                  <h3 className="assignment-title">{assignment.title}</h3>
                  <p
                    className={`assignment-preview${
                      assignment.description ? '' : ' assignment-preview--empty'
                    }`}
                  >
                    {assignment.description || 'No description yet.'}
                  </p>
                  <div className="assignment-card-foot">
                    <span
                      className="status-pill"
                      style={{
                        color: tone.color,
                        backgroundColor: tone.wash,
                        borderColor: tone.line,
                      }}
                    >
                      {assignment.status}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        {/* Hash anchor carrying the course → the Assignments page shows only this
            course's assignments via the ?course=ID query (see AssignmentsPage) */}
        <a
          href={`#assignments?course=${course.id}`}
          className="btn-link course-detail-action"
        >
          View all assignments
          <Icon name="arrow" className="icon--sm" aria-hidden="true" />
        </a>
      </section>

      {/* -------- Study Planner -------- */}
      <section className="section course-detail-section">
        <div className="section-head">
          <p className="kicker">Study Planner</p>
          <h2>Study Planner</h2>
          <span className="tag">{courseTasks.length} study tasks</span>
        </div>
        {courseTasks.length === 0 ? (
          <p className="status-message">No study tasks for this course yet.</p>
        ) : (
          <div className="planner-grid">
            {courseTasks.map((task) => {
              const tone = statusTone(task.status)
              const pTone = priorityTone(task.priority)
              const completed = task.status === 'Completed'
              return (
                <article
                  className={`planner-card${
                    completed ? ' planner-card--completed' : ''
                  }`}
                  key={task.id}
                >
                  <div className="planner-card-top">
                    <span className="planner-index">
                      {completed ? (
                        <Icon name="check" className="icon--sm" aria-hidden="true" />
                      ) : (
                        String(task.id).padStart(2, '0')
                      )}
                    </span>
                    <span
                      className="priority-pill"
                      style={{
                        color: pTone.color,
                        backgroundColor: pTone.wash,
                        borderColor: pTone.line,
                      }}
                    >
                      {task.priority}
                    </span>
                  </div>
                  <h3 className="planner-title">{task.title}</h3>
                  <p
                    className={`planner-preview${
                      task.description ? '' : ' planner-preview--empty'
                    }`}
                  >
                    {task.description || 'No description yet.'}
                  </p>
                  <div className="planner-card-foot">
                    <div className="planner-card-foot-left">
                      <span
                        className={`planner-date${
                          task.study_date ? '' : ' planner-date--none'
                        }`}
                      >
                        {task.study_date ? formatDate(task.study_date) : 'No date'}
                      </span>
                      <span
                        className="status-pill"
                        style={{
                          color: tone.color,
                          backgroundColor: tone.wash,
                          borderColor: tone.line,
                        }}
                      >
                        {task.status}
                      </span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        {/* Hash anchor carrying the course → the Study Planner page shows only this
            course's study tasks via the ?course=ID query (see StudyPlannerPage) */}
        <a
          href={`#planner?course=${course.id}`}
          className="btn-link course-detail-action"
        >
          View planner
          <Icon name="arrow" className="icon--sm" aria-hidden="true" />
        </a>
      </section>

      {/* -------- Resources -------- */}
      <section className="section course-detail-section">
        <div className="section-head">
          <p className="kicker">Resources</p>
          <h2>Resources</h2>
          <span className="tag">{courseResources.length} resources</span>
        </div>
        {courseResources.length === 0 ? (
          <p className="status-message">No resources for this course yet.</p>
        ) : (
          <div className="note-grid">
            {courseResources.map((resource) => (
              <article className="note-card" key={resource.id}>
                <div className="note-card-top">
                  <span className="note-index">
                    {String(resource.id).padStart(2, '0')}
                  </span>
                  <span className="note-date">
                    {formatDate(resource.created_at)}
                  </span>
                </div>
                <h3 className="note-title">{resource.title}</h3>
                {resource.description && (
                  <p className="note-preview">{resource.description}</p>
                )}
                <div className="note-card-foot">
                  <span className="note-type">{resource.resource_type}</span>
                </div>
              </article>
            ))}
          </div>
        )}
        {/* Hash anchor carrying the course → the Resources page shows only this
            course's resources via the ?course=ID query (see ResourcesPage) */}
        <a
          href={`#resources?course=${course.id}`}
          className="btn-link course-detail-action"
        >
          View all resources
          <Icon name="arrow" className="icon--sm" aria-hidden="true" />
        </a>
      </section>
    </div>
  )
}

// SessionStorage key holding the course the student had open, so a trip to
// the Notes / Assignments / Planner pages (and back) reopens the same detail
// view — each of those pages can also narrow itself to that course via its
// ?course=ID hash filter.
const OPEN_COURSE_KEY = 'campus-open-course-id'

function rememberOpenCourse(courseId) {
  sessionStorage.setItem(OPEN_COURSE_KEY, String(courseId))
}

function clearOpenCourse() {
  sessionStorage.removeItem(OPEN_COURSE_KEY)
}

// Read the remembered course id (a positive integer), or null when absent.
function restoreOpenCourse() {
  const id = Number(sessionStorage.getItem(OPEN_COURSE_KEY))
  return Number.isInteger(id) && id > 0 ? id : null
}

function CoursesPage() {
  // The course catalog + the user's own study data (notes, assignments, study
  // tasks and resources), so each card can show how many belong to that course.
  const [courses, setCourses] = useState([])
  const [notes, setNotes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [studyTasks, setStudyTasks] = useState([])
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Bump this value to re-run the fetches (used by the Retry button)
  const [reloadKey, setReloadKey] = useState(0)

  // The course currently open in the detail view (null = showing the list).
  // Restored from sessionStorage so leaving for Notes / Assignments / Planner
  // and coming back does not drop the student mid-course.
  const [selectedCourseId, setSelectedCourseId] = useState(restoreOpenCourse)

  // Load everything from the real backend. All the fetches are independent,
  // so one failing request is caught here and turns into the error panel.
  useEffect(() => {
    async function load() {
      try {
        const [coursesData, notesData, assignmentsData, tasksData, resourcesData] =
          await Promise.all([
            fetchCourses(),
            fetchNotes(),
            fetchAssignments(),
            fetchStudyTasks(),
            getResources(),
          ])
        setCourses(coursesData)
        setNotes(notesData)
        setAssignments(assignmentsData)
        setStudyTasks(tasksData)
        setResources(resourcesData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [reloadKey])

  // Retry button: show loading again and refetch
  function retry() {
    setLoading(true)
    setError('')
    setReloadKey((key) => key + 1)
  }

  // Open one course's detail view
  function openCourse(courseId) {
    setSelectedCourseId(courseId)
    rememberOpenCourse(courseId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Return to the full course list
  function backToCourses() {
    setSelectedCourseId(null)
    clearOpenCourse()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // The full course object for the open detail view, if we still have it
  // loaded (after a retry the id is simply gone → show the list again).
  const selectedCourse = courses.find((course) => course.id === selectedCourseId)

  // -------- Detail view (one course is open) --------
  if (selectedCourse) {
    return (
      <div className="courses-page">
        <CourseDetail
          course={selectedCourse}
          notes={notes}
          assignments={assignments}
          studyTasks={studyTasks}
          resources={resources}
          onBack={backToCourses}
        />
      </div>
    )
  }

  // -------- List view (no course open yet) --------
  return (
    <div className="courses-page">
      {/* -------- Heading -------- */}
      <div className="section-head">
        <p className="kicker">Courses</p>
        <h2>Your courses</h2>
        <div className="section-head-actions">
          {!loading && !error && courses.length > 0 && (
            <span className="tag">{courses.length} courses</span>
          )}
        </div>
      </div>

      {/* -------- Loading -------- */}
      {loading && (
        <div className="course-grid" role="status" aria-label="Loading courses">
          {[1, 2, 3].map((n) => (
            <div className="course-skeleton" key={n}>
              <div className="skeleton skeleton-mark" />
              <div className="skeleton skeleton-line w-70" />
              <div className="skeleton skeleton-line w-95" />
              <div className="skeleton skeleton-line w-40" />
            </div>
          ))}
        </div>
      )}

      {/* -------- Error -------- */}
      {!loading && error && (
        <div className="error-panel" role="alert">
          <Icon name="alert" className="icon--lg error-icon" />
          <div className="error-copy">
            <p className="error-title">Couldn’t load your courses</p>
            <p className="error-detail">{error}</p>
            <p className="error-hint">
              Make sure the backend is running on port 5000, then try again.
            </p>
          </div>
          <button type="button" className="btn btn-primary retry" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {/* -------- Empty -------- */}
      {!loading && !error && courses.length === 0 && (
        <p className="status-message">
          Your course list is empty for now. Check back after enrolment.
        </p>
      )}

      {/* -------- Course cards (real database data) -------- */}
      {!loading && !error && courses.length > 0 && (
        <div className="course-grid">
          {courses.map((course) => {
            const accent = ACCENTS[course.id % ACCENTS.length]
            const isSelected = course.id === selectedCourseId

            // How much of the user's own study data belongs to this course
            const noteCount = notes.filter((note) => note.course_id === course.id).length
            const assignmentCount = assignments.filter(
              (a) => a.course_id === course.id
            ).length
            const taskCount = studyTasks.filter(
              (task) => task.course_id === course.id
            ).length

            return (
              <article
                className="course-card"
                key={course.id}
                onClick={() => openCourse(course.id)}
                style={
                  isSelected
                    ? { borderColor: accent.color, boxShadow: `0 0 0 2px ${accent.line}` }
                    : undefined
                }
              >
                <div className="course-card-top">
                  <span
                    className="course-mark"
                    style={{
                      color: accent.color,
                      backgroundColor: accent.wash,
                      borderColor: accent.line,
                    }}
                  >
                    {course.code}
                  </span>
                  <span className="course-index">
                    {String(course.id).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="course-title">{course.name}</h3>
                <p className="course-meta">Code · {course.code}</p>
                <p className="course-meta">Added {formatDate(course.created_at)}</p>
                <p className="course-meta">
                  {countText(noteCount, 'note')} · {countText(assignmentCount, 'assignment')} ·{' '}
                  {countText(taskCount, 'study task')}
                </p>
                <div className="course-card-foot">
                  <span className="course-status">
                    <span className="status-dot" aria-hidden="true" />
                    {isSelected ? 'Selected' : 'Enrolled'}
                  </span>
                  <button
                    type="button"
                    className="course-link"
                    onClick={() => openCourse(course.id)}
                    aria-pressed={isSelected}
                  >
                    View course
                    <Icon name="arrow" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default CoursesPage
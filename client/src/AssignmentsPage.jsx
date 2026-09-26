import { useEffect, useState } from 'react'
import {
  createAssignment,
  deleteAssignment,
  fetchAssignments,
  fetchCourses,
  updateAssignment,
} from './api.js'
import CourseFilterBanner from './CourseFilterBanner.jsx'
import { Icon } from './Icon.jsx'
import { ACCENTS, courseIdFromHash, formatDate, statusTone } from './ui.js'
import { useCourseFilter } from './useCourseFilter.js'

function AssignmentsPage({ createOnMount = false }) {
  // Assignments + courses from the backend
  const [assignments, setAssignments] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Bump this value to re-run the fetch (used by Retry and after saving)
  const [reloadKey, setReloadKey] = useState(0)

  // Create-assignment form state (opens straight away when the dashboard's
  // "Add assignment" quick action sent the user here)
  const [formOpen, setFormOpen] = useState(createOnMount)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Starts at the filtered course when the student arrived from a course's
  // "View all assignments" (#assignments?course=…) — kept in sync by
  // useCourseFilter's onFilterChange callback.
  const [courseId, setCourseId] = useState(() => {
    const id = courseIdFromHash()
    return id ? String(id) : ''
  })
  const [dueDate, setDueDate] = useState('')
  const [status, setStatus] = useState('Pending')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Card-level actions (status toggle + delete)
  const [statusBusyId, setStatusBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  // Shared course filter from the hash (#assignments?course=ID). The hook reads
  // the hash, keeps courseFilterId in sync (deep links, header nav,
  // back/forward, the banner's "clear") and resolves the selected course from
  // the catalog for the banner. onFilterChange keeps the create form's default
  // course in step with the same hash changes.
  const {
    courseFilterId,
    filterCourse,
    filterAccent,
    ready,
    clearHref,
  } = useCourseFilter({
    courses,
    loading,
    baseView: 'assignments',
    onFilterChange: (id) => setCourseId(id ? String(id) : ''),
  })

  // Load assignments + courses from the real backend. The assignments request
  // carries the active course filter, so a filtered page only ever fetches
  // that course's assignments (the backend still scopes everything to the
  // logged-in user).
  useEffect(() => {
    async function load() {
      try {
        const [assignmentsData, coursesData] = await Promise.all([
          fetchAssignments(courseFilterId),
          fetchCourses(),
        ])
        setAssignments(assignmentsData)
        setCourses(coursesData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [reloadKey, courseFilterId])

  // Retry button: show loading again and refetch
  function retry() {
    setLoading(true)
    setError('')
    setReloadKey((key) => key + 1)
  }

  function toggleForm() {
    setFormOpen((open) => !open)
    setSaveError('')
  }

  // Save the new assignment to the backend, then refresh the list
  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')

    try {
      await createAssignment({
        title: title.trim(),
        description: description.trim(),
        course_id: Number(courseId),
        due_date: dueDate === '' ? undefined : dueDate,
        status,
      })

      // Success: confirm to the user, close the form, refresh the list
      setSuccessMessage('Assignment created successfully')
      setTitle('')
      setDescription('')
      setCourseId('')
      setDueDate('')
      setStatus('Pending')
      setFormOpen(false)
      setReloadKey((key) => key + 1)

      // Let the success message fade out on its own
      setTimeout(() => setSuccessMessage(''), 4000)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Toggle an assignment between Pending and Completed, then refresh
  async function handleToggleStatus(assignment) {
    const nextStatus = assignment.status === 'Completed' ? 'Pending' : 'Completed'

    setStatusBusyId(assignment.id)
    setActionError('')

    try {
      await updateAssignment(assignment.id, { status: nextStatus })
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t update “${assignment.title}”: ${err.message}`)
    } finally {
      setStatusBusyId(null)
    }
  }

  // Remove an assignment, then refresh
  async function handleDelete(assignment) {
    setDeleteBusyId(assignment.id)
    setActionError('')

    try {
      await deleteAssignment(assignment.id)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t delete “${assignment.title}”: ${err.message}`)
    } finally {
      setDeleteBusyId(null)
    }
  }

  const canSave = title.trim() !== '' && courseId !== ''

  return (
    <div className="assignments-page">
      {/* -------- Heading + create button -------- */}
      <div className="section-head">
        <p className="kicker">Assignments</p>
        <h2>Assignments</h2>
        <div className="section-head-actions">
          {!loading && !error && assignments.length > 0 && (
            <span className="tag">{assignments.length} assignments</span>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={toggleForm}
          >
            {formOpen ? 'Close form' : 'Create assignment'}
          </button>
        </div>
      </div>

      {/* -------- Course-context banner (opened from a course's "View all assignments") -------- */}
      {/* Gated on ready (!loading) so the course name is always available for the label. */}
      {ready && courseFilterId && (
        <CourseFilterBanner
          itemLabel="Assignments"
          course={filterCourse}
          courseId={courseFilterId}
          accent={filterAccent}
          clearHref={clearHref}
          clearText="View all assignments"
          clearAriaLabel="Clear course filter — show all assignments"
        />
      )}

      {/* -------- Success banner -------- */}
      {successMessage && (
        <p className="form-success" role="status">
          ✓ {successMessage}
        </p>
      )}

      {/* -------- Create-assignment form -------- */}
      {formOpen && (
        <form className="assignment-form" onSubmit={handleSave}>
          <div className="field">
            <label htmlFor="assignment-title">Title</label>
            <input
              id="assignment-title"
              type="text"
              placeholder="e.g. Group project — research paper"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="assignment-description">Description</label>
            <textarea
              id="assignment-description"
              rows="4"
              placeholder="A short brief for the assignment…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="assignment-course">Course</label>
            <select
              id="assignment-course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              required
            >
              <option value="">Select a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="assignment-due">Due date</label>
            <input
              id="assignment-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="assignment-status">Status</label>
            <select
              id="assignment-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {saveError && <p className="form-error">⚠️ {saveError}</p>}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSave || saving}
            >
              {saving ? 'Saving…' : 'Save assignment'}
            </button>
            <button type="button" className="btn-link" onClick={toggleForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* -------- Error from a status toggle / delete -------- */}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {/* -------- Loading -------- */}
      {loading && (
        <div
          className="assignment-grid"
          role="status"
          aria-label="Loading assignments"
        >
          {[1, 2, 3].map((n) => (
            <div className="assignment-skeleton" key={n}>
              <div className="skeleton skeleton-line w-30" />
              <div className="skeleton skeleton-line w-95" />
              <div className="skeleton skeleton-line w-80" />
            </div>
          ))}
        </div>
      )}

      {/* -------- Error -------- */}
      {!loading && error && (
        <div className="error-panel" role="alert">
          <Icon name="alert" className="icon--lg error-icon" />
          <div className="error-copy">
            <p className="error-title">Couldn’t load your assignments</p>
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
      {!loading && !error && assignments.length === 0 && (
        <p className="status-message">
          {courseFilterId
            ? 'No assignments for this course yet — tap “Create assignment” to add one.'
            : 'No assignments yet — tap “Create assignment” to add your first one.'}
        </p>
      )}

      {/* -------- Assignments list (real database data) -------- */}
      {!loading && !error && assignments.length > 0 && (
        <div className="assignment-grid">
          {assignments.map((assignment) => {
            const accent = ACCENTS[assignment.course_id % ACCENTS.length]
            const tone = statusTone(assignment.status)
            const statusBusy = statusBusyId === assignment.id
            const deleteBusy = deleteBusyId === assignment.id

            let actionLabel = 'Mark completed'
            if (assignment.status === 'Completed') actionLabel = 'Mark pending'
            if (statusBusy) actionLabel = 'Saving…'

            const deleteLabel = deleteBusy ? 'Deleting…' : 'Delete'

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
                <div className="assignment-meta">
                  <span
                    className="course-chip"
                    style={{
                      color: accent.color,
                      backgroundColor: accent.wash,
                      borderColor: accent.line,
                    }}
                  >
                    {assignment.course_code}
                  </span>
                  <span className="assignment-course-name">
                    {assignment.course_name}
                  </span>
                </div>
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
                  <div className="assignment-actions">
                    <button
                      type="button"
                      className="assignment-action"
                      onClick={() => handleToggleStatus(assignment)}
                      disabled={statusBusy || deleteBusy}
                    >
                      {actionLabel}
                    </button>
                    <button
                      type="button"
                      className="assignment-action assignment-action--danger"
                      onClick={() => handleDelete(assignment)}
                      disabled={statusBusy || deleteBusy}
                    >
                      <Icon name="trash" className="icon--sm" />
                      {deleteLabel}
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AssignmentsPage
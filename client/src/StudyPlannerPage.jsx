import { useEffect, useState } from 'react'
import {
  createStudyTask,
  deleteStudyTask,
  fetchCourses,
  fetchStudyTasks,
  generateStudyPlan,
  updateStudyTask,
} from './api.js'
import CourseFilterBanner from './CourseFilterBanner.jsx'
import { Icon } from './Icon.jsx'
import {
  ACCENTS,
  courseIdFromHash,
  dateKey,
  formatDate,
  priorityTone,
  statusTone,
} from './ui.js'
import { useCourseFilter } from './useCourseFilter.js'

// A single task card (used in every group)
function TaskCard({ task, statusBusyId, deleteBusyId, onToggleStatus, onDelete }) {
  const accent = ACCENTS[task.course_id % ACCENTS.length]
  const tone = statusTone(task.status)
  const pTone = priorityTone(task.priority)
  const completed = task.status === 'Completed'
  const statusBusy = statusBusyId === task.id
  const deleteBusy = deleteBusyId === task.id

  let actionLabel = 'Mark completed'
  if (completed) actionLabel = 'Back to pending'
  if (statusBusy) actionLabel = 'Saving…'

  const deleteLabel = deleteBusy ? 'Deleting…' : 'Delete'

  return (
    <article
      className={`planner-card${completed ? ' planner-card--completed' : ''}`}
    >
      <div className="planner-card-top">
        <span className="planner-index">
          {completed ? (
            <Icon name="check" className="icon--sm" />
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
      <div className="planner-meta">
        <span
          className="course-chip"
          style={{
            color: accent.color,
            backgroundColor: accent.wash,
            borderColor: accent.line,
          }}
        >
          {task.course_code}
        </span>
        <span className="planner-course-name">{task.course_name}</span>
      </div>
      <div className="planner-card-foot">
        <div className="planner-card-foot-left">
          <span className={`planner-date${task.study_date ? '' : ' planner-date--none'}`}>
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
        <div className="planner-actions">
          <button
            type="button"
            className="planner-action"
            onClick={() => onToggleStatus(task)}
            disabled={statusBusy || deleteBusy}
          >
            {actionLabel}
          </button>
          <button
            type="button"
            className="planner-action planner-action--danger"
            onClick={() => onDelete(task)}
            disabled={statusBusy || deleteBusy}
          >
            <Icon name="trash" className="icon--sm" />
            {deleteLabel}
          </button>
        </div>
      </div>
    </article>
  )
}

// A labelled group of task cards (Today’s / Upcoming / Completed)
function PlannerGroup({ title, tasks, empty, ...cardProps }) {
  return (
    <section className="planner-group">
      <div className="planner-group-head">
        <h3 className="planner-group-title">{title}</h3>
        <span className="tag">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="planner-empty">{empty}</p>
      ) : (
        <div className="planner-grid">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} {...cardProps} />
          ))}
        </div>
      )}
    </section>
  )
}

function StudyPlannerPage() {
  // Study tasks + courses from the backend
  const [tasks, setTasks] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Bump this value to re-run the fetch (used by Retry and after saving)
  const [reloadKey, setReloadKey] = useState(0)

  // Create-task form state
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Starts at the filtered course when the student arrived from a course's
  // "View planner" (#planner?course=…) — kept in sync by useCourseFilter's
  // onFilterChange callback.
  const [courseId, setCourseId] = useState(() => {
    const id = courseIdFromHash()
    return id ? String(id) : ''
  })
  const [studyDate, setStudyDate] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [status, setStatus] = useState('Pending')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Card-level actions (status toggle + delete)
  const [statusBusyId, setStatusBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  // AI study planner state — the proposed plan lives in this component state
  // (generation is never persisted server-side):
  //  - planSessions: the editable review list (rebuilt when a new plan loads)
  //  - planRequestedText: the request echoed above the proposed sessions
  //  - planLoading / planError: the Generate → Gemini → render flow
  const [planRequest, setPlanRequest] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState('')
  const [planSessions, setPlanSessions] = useState([])
  const [planRequestedText, setPlanRequestedText] = useState('')

  // Saving the reviewed sessions as study tasks — sequential createStudyTask
  // calls reusing the existing authenticated route (no bulk endpoint needed).
  //  - planSaving: in-flight guard (button disabled, no double submits)
  //  - planSaveError: full-or-partial failure message (a partial message says
  //    how many sessions WERE saved before the one that failed)
  //  - planSaveSuccess: transient confirmation, auto-fades like the manual one
  const [planSaving, setPlanSaving] = useState(false)
  const [planSaveError, setPlanSaveError] = useState('')
  const [planSaveSuccess, setPlanSaveSuccess] = useState('')

  // Shared course filter from the hash (#planner?course=ID). The hook reads the
  // hash, keeps courseFilterId in sync (deep links, header nav, back/forward,
  // the banner's "clear") and resolves the selected course from the catalog
  // for the banner. onFilterChange keeps the create form's default course in
  // step with the same hash changes.
  const {
    courseFilterId,
    filterCourse,
    filterAccent,
    ready,
    clearHref,
  } = useCourseFilter({
    courses,
    loading,
    baseView: 'planner',
    onFilterChange: (id) => setCourseId(id ? String(id) : ''),
  })

  // Load study tasks + courses from the real backend. The tasks request carries
  // the active course filter, so a filtered page only ever fetches that
  // course's tasks (the backend still scopes everything to the logged-in user).
  useEffect(() => {
    async function load() {
      try {
        const [tasksData, coursesData] = await Promise.all([
          fetchStudyTasks(courseFilterId),
          fetchCourses(),
        ])
        setTasks(tasksData)
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

  // Ask Campus AI for a study plan. Generation only — nothing is written to
  // the database yet. While a request is in flight the button is disabled and
  // the loading state shows, so double-submissions can't happen.
  async function handleGeneratePlan(event) {
    event.preventDefault()
    const trimmed = planRequest.trim()
    if (!trimmed || planLoading) return

    setPlanLoading(true)
    setPlanError('')

    try {
      const data = await generateStudyPlan(trimmed)
      // The backend validates the sessions, but the frontend still guards: a
      // plan that somehow comes back empty is an error, not a blank list.
      const sessions = Array.isArray(data.sessions) ? data.sessions : []
      if (sessions.length === 0) {
        setPlanError(
          'The plan came back empty — try rephrasing your request and generate again.'
        )
        setPlanSessions([])
      } else {
        setPlanSessions(sessions)
        setPlanRequestedText(trimmed)
      }
    } catch (err) {
      // err.message is always a safe, human sentence (server errors are
      // already curated; network failures are translated in api.js).
      setPlanError(err.message)
    } finally {
      setPlanLoading(false)
    }
  }

  // Local edit of one proposed session field — never persisted.
  function updateSession(index, patch) {
    setPlanSessions((sessions) =>
      sessions.map((session, i) => (i === index ? { ...session, ...patch } : session))
    )
  }

  // Resolve a proposed session's course from the user's own course catalog
  // (the same list the create form uses). A courseId that matches nothing
  // stays null so the UI shows a safe fallback instead of inventing data.
  function courseForSession(session) {
    return (
      courses.find((course) => course.id === Number(session.courseId)) || null
    )
  }

  // Date validity mirrors the backend's rule (a real date in YYYY-MM-DD).
  function isValidDateString(value) {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    )
  }

  // Defensive pre-flight check on the CURRENT edited sessions before any POST.
  // Returns human-readable problems; an empty list means "ready to save".
  // The backend stays authoritative — this only stops obviously-broken saves
  // and avoids burning a partial run on a session that can't be stored.
  function validateSessions(sessions) {
    const availableCourseIds = new Set(courses.map((c) => c.id))
    const problems = []
    sessions.forEach((session, index) => {
      const num = index + 1
      if (typeof session.title !== 'string' || session.title.trim() === '') {
        problems.push(`session ${num} needs a title`)
      }
      const courseId = Number(session.courseId)
      if (!Number.isInteger(courseId) || courseId <= 0) {
        problems.push(`session ${num} has an invalid course`)
      } else if (availableCourseIds.size > 0 && !availableCourseIds.has(courseId)) {
        // Only enforce membership once the catalog is loaded; while courses are
        // still in flight the (authoritative) backend still validates existence.
        problems.push(`session ${num} has an invalid course`)
      }
      if (
        session.date !== undefined &&
        session.date !== '' &&
        !isValidDateString(session.date)
      ) {
        problems.push(`session ${num} has an invalid date`)
      }
      if (!['Low', 'Medium', 'High'].includes(session.priority)) {
        problems.push(`session ${num} has an invalid priority`)
      }
    })
    return problems
  }

  const canGenerate = planRequest.trim() !== '' && !planLoading
  const canSavePlan = planSessions.length > 0 && !planSaving

  // Save every reviewed session as a study task, using the user's CURRENT
  // edits (never the original Gemini values). Sequential createStudyTask calls
  // are intentional: the backend stays the single source of truth for auth,
  // ownership and validation, and there is no bulk endpoint to reach for.
  // If a mid-way save fails, the already-saved sessions are dropped from the
  // review list so a retry can't create duplicates, and the UI says exactly
  // how many were saved before the failure.
  async function handleSavePlan() {
    if (planSaving || planSessions.length === 0) return

    // Snapshot so edits made mid-run can't change what we're saving.
    const sessions = planSessions
    const problems = validateSessions(sessions)
    if (problems.length > 0) {
      setPlanSaveError(
        `Couldn't save the study plan — ${problems.join('; ')}.`
      )
      return
    }

    setPlanSaving(true)
    setPlanSaveError('')

    let savedCount = 0
    try {
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i]
        await createStudyTask({
          title: session.title.trim(),
          course_id: Number(session.courseId),
          // An empty date means "no date" — matching the manual create form
          // (the backend stores NULL instead of rejecting an empty string).
          study_date: session.date || undefined,
          priority: session.priority,
          status: 'Pending',
        })
        savedCount++
      }

      // Everything saved: clear the review list, refresh the task groups,
      // and confirm. The Dashboard picks the new tasks up through its own
      // existing refresh path (refetch on entering Dashboard).
      setPlanSessions([])
      setPlanRequestedText('')
      setPlanSaveError('')
      setPlanSaveSuccess(
        `Study plan saved successfully (${savedCount} ${
          savedCount === 1 ? 'session' : 'sessions'
        } added to your study tasks).`
      )
      setReloadKey((key) => key + 1)
      setTimeout(() => setPlanSaveSuccess(''), 4000)
    } catch (err) {
      if (savedCount > 0) {
        // Partial save — be explicit about it and keep the unsaved sessions
        // editable so the student can retry without duplicating.
        setPlanSessions(sessions.slice(savedCount))
        setPlanSaveError(
          `${savedCount} of ${sessions.length} sessions were saved, then session ${
            savedCount + 1
          } failed: ${err.message}. The remaining sessions are still here — fix them and save again.`
        )
        setReloadKey((key) => key + 1)
      } else {
        setPlanSaveError(
          `Couldn't save the study plan: ${err.message}. Nothing was changed.`
        )
      }
    } finally {
      setPlanSaving(false)
    }
  }

  // Save the new task to the backend, then refresh the list
  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')

    try {
      await createStudyTask({
        title: title.trim(),
        description: description.trim(),
        course_id: Number(courseId),
        study_date: studyDate === '' ? undefined : studyDate,
        priority,
        status,
      })

      // Success: confirm to the user, close the form, refresh the list
      setSuccessMessage('Study task created successfully')
      setTitle('')
      setDescription('')
      setCourseId('')
      setStudyDate('')
      setPriority('Medium')
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

  // Toggle a task between Pending and Completed, then refresh
  async function handleToggleStatus(task) {
    const nextStatus = task.status === 'Completed' ? 'Pending' : 'Completed'

    setStatusBusyId(task.id)
    setActionError('')

    try {
      await updateStudyTask(task.id, { status: nextStatus })
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t update “${task.title}”: ${err.message}`)
    } finally {
      setStatusBusyId(null)
    }
  }

  // Remove a task, then refresh
  async function handleDelete(task) {
    setDeleteBusyId(task.id)
    setActionError('')

    try {
      await deleteStudyTask(task.id)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t delete “${task.title}”: ${err.message}`)
    } finally {
      setDeleteBusyId(null)
    }
  }

  /* -------- Group the tasks into Today / Upcoming / Completed -------- */

  const todayKey = dateKey(new Date().toISOString())

  const todayTasks = []
  const upcomingTasks = []
  const completedTasks = []

  tasks.forEach((task) => {
    if (task.status === 'Completed') {
      completedTasks.push(task)
      return
    }
    const key = dateKey(task.study_date)
    // Pending tasks dated today — or earlier (overdue) — belong to "Today"
    if (key && key <= todayKey) {
      todayTasks.push(task)
    } else {
      upcomingTasks.push(task)
    }
  })

  // Today first, then overdue (most recently overdue first)
  todayTasks.sort((a, b) => {
    const aIsToday = dateKey(a.study_date) === todayKey
    const bIsToday = dateKey(b.study_date) === todayKey
    if (aIsToday !== bIsToday) return aIsToday ? -1 : 1
    return dateKey(b.study_date).localeCompare(dateKey(a.study_date))
  })

  // Soonest first, undated tasks last
  upcomingTasks.sort((a, b) => {
    const keyA = dateKey(a.study_date)
    const keyB = dateKey(b.study_date)
    if (!keyA) return 1
    if (!keyB) return -1
    return keyA.localeCompare(keyB)
  })

  // Most recently completed first, undated tasks last
  completedTasks.sort((a, b) => {
    const keyA = dateKey(a.study_date)
    const keyB = dateKey(b.study_date)
    if (!keyA) return 1
    if (!keyB) return -1
    return keyB.localeCompare(keyA)
  })

  const cardProps = {
    statusBusyId,
    deleteBusyId,
    onToggleStatus: handleToggleStatus,
    onDelete: handleDelete,
  }

  const canSave = title.trim() !== '' && courseId !== ''

  return (
    <div className="planner-page">
      {/* -------- Heading + create button -------- */}
      <div className="section-head">
        <p className="kicker">Study Planner</p>
        <h2>Study planner</h2>
        <div className="section-head-actions">
          {!loading && !error && tasks.length > 0 && (
            <span className="tag">{tasks.length} tasks</span>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={toggleForm}
          >
            {formOpen ? 'Close form' : 'Create study task'}
          </button>
        </div>
      </div>

      {/* -------- AI Study Planner (generate → review/edit → save) -------- */}
      <section className="ai-plan" aria-labelledby="ai-plan-title">
        <div className="ai-plan-intro">
          <p className="kicker">AI Study Planner</p>
          <h3 id="ai-plan-title">Generate a study plan</h3>
          <p className="ai-plan-helper">
            Tell Campus AI what you’re preparing for, and it will create a study
            plan for you.
          </p>
        </div>

        <form className="ai-plan-form" onSubmit={handleGeneratePlan}>
          <div className="field">
            <label htmlFor="plan-request">What are you preparing for?</label>
            <textarea
              id="plan-request"
              rows="4"
              placeholder="I have an Economics exam on October 15. I have 5 chapters and can study 2 hours every day."
              value={planRequest}
              onChange={(e) => setPlanRequest(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canGenerate}
            >
              {planLoading ? 'Generating…' : 'Generate study plan'}
            </button>
          </div>
        </form>

        {planSaveSuccess && (
          <p className="form-success ai-plan-save-success" role="status">
            ✓ {planSaveSuccess}
          </p>
        )}

        {planSaveError && (
          <div className="error-panel ai-plan-error" role="alert">
            <Icon name="alert" className="icon--lg error-icon" />
            <div className="error-copy">
              <p className="error-title">Couldn’t save all sessions</p>
              <p className="error-detail">{planSaveError}</p>
              <p className="error-hint">
                Your review list still shows what hasn’t been saved yet.
              </p>
            </div>
          </div>
        )}

        {planError && (
          <div className="error-panel ai-plan-error" role="alert">
            <Icon name="alert" className="icon--lg error-icon" />
            <div className="error-copy">
              <p className="error-title">Couldn’t generate a plan</p>
              <p className="error-detail">{planError}</p>
              <p className="error-hint">
                You can try again — your request is still in the box above.
              </p>
            </div>
          </div>
        )}

        {planLoading && (
          <div
            className="assistant-loading ai-plan-loading"
            role="status"
            aria-label="Generating your study plan"
          >
            <p className="ai-plan-loading-label">
              Campus AI is building your plan…
            </p>
            <div className="skeleton skeleton-line w-80" />
            <div className="skeleton skeleton-line w-95" />
            <div className="skeleton skeleton-line w-70" />
          </div>
        )}

        {!planLoading && planSessions.length > 0 && (
          <div className="ai-plan-results">
            <div className="ai-plan-results-head">
              <span className="ai-plan-results-label">Proposed study sessions</span>
              <span className="tag">
                {planSessions.length}{' '}
                {planSessions.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            <p className="assistant-question">“{planRequestedText}”</p>
            <p className="ai-plan-edit-hint">
              Review and adjust the sessions below, then save them to your
              study tasks.
            </p>

            <ol className="ai-plan-list">
              {planSessions.map((session, index) => {
                const course = courseForSession(session)
                const accent = course
                  ? ACCENTS[Number(course.id) % ACCENTS.length]
                  : null
                return (
                  <li className="ai-plan-session" key={index}>
                    <div className="ai-plan-session-head">
                      <span className="ai-plan-session-index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {course ? (
                        <span
                          className="course-chip"
                          style={{
                            color: accent.color,
                            backgroundColor: accent.wash,
                            borderColor: accent.line,
                          }}
                        >
                          {course.code}
                        </span>
                      ) : (
                        <span className="note-type">Course unavailable</span>
                      )}
                    </div>

                    <div className="form-row">
                      <div className="field">
                        <label htmlFor={`session-${index}-title`}>Title</label>
                        <input
                          id={`session-${index}-title`}
                          type="text"
                          value={session.title}
                          onChange={(e) =>
                            updateSession(index, { title: e.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`session-${index}-course`}>Course</label>
                        <select
                          id={`session-${index}-course`}
                          value={String(session.courseId)}
                          onChange={(e) =>
                            updateSession(index, {
                              courseId: Number(e.target.value),
                            })
                          }
                        >
                          {!course && <option value="">Course unavailable</option>}
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} — {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="field">
                        <label htmlFor={`session-${index}-date`}>Date</label>
                        <input
                          id={`session-${index}-date`}
                          type="date"
                          value={session.date || ''}
                          onChange={(e) =>
                            updateSession(index, { date: e.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`session-${index}-priority`}>
                          Priority
                        </label>
                        <select
                          id={`session-${index}-priority`}
                          value={session.priority}
                          onChange={(e) =>
                            updateSession(index, { priority: e.target.value })
                          }
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="ai-plan-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSavePlan}
                disabled={!canSavePlan}
                title={
                  planSaving
                    ? 'Saving these sessions to your study tasks…'
                    : 'Save every reviewed session as a study task'
                }
              >
                {planSaving ? 'Saving…' : 'Save to study tasks'}
              </button>
              <p className="ai-plan-foot-note">
                Saves each session as a study task with your current edits.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* -------- Course-context banner (opened from a course's "View planner") -------- */}
      {/* Gated on ready (!loading) so the course name is always available for the label. */}
      {ready && courseFilterId && (
        <CourseFilterBanner
          itemLabel="Study Planner"
          course={filterCourse}
          courseId={courseFilterId}
          accent={filterAccent}
          clearHref={clearHref}
          clearText="View all tasks"
          clearAriaLabel="Clear course filter — show all study tasks"
        />
      )}

      {/* -------- Success banner -------- */}
      {successMessage && (
        <p className="form-success" role="status">
          ✓ {successMessage}
        </p>
      )}

      {/* -------- Create-study-task form -------- */}
      {formOpen && (
        <form className="planner-form" onSubmit={handleSave}>
          <div className="field">
            <label htmlFor="task-title">Title</label>
            <input
              id="task-title"
              type="text"
              placeholder="e.g. Revise Unit 3 — market structures"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="task-description">Description</label>
            <textarea
              id="task-description"
              rows="4"
              placeholder="What to cover — outline, readings, problems…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="task-course">Course</label>
              <select
                id="task-course"
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
              <label htmlFor="task-date">Study date</label>
              <input
                id="task-date"
                type="date"
                value={studyDate}
                onChange={(e) => setStudyDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="task-priority">Priority</label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="task-status">Status</label>
              <select
                id="task-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          {saveError && <p className="form-error">⚠️ {saveError}</p>}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSave || saving}
            >
              {saving ? 'Saving…' : 'Save task'}
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
          className="planner-grid"
          role="status"
          aria-label="Loading study tasks"
        >
          {[1, 2, 3].map((n) => (
            <div className="planner-skeleton" key={n}>
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
            <p className="error-title">Couldn’t load your study plan</p>
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
      {!loading && !error && tasks.length === 0 && (
        <p className="status-message">
          {courseFilterId
            ? 'No study tasks for this course yet — tap “Create study task” to plan your week.'
            : 'No study tasks yet — tap “Create study task” to plan your week.'}
        </p>
      )}

      {/* -------- Grouped task lists (real database data) -------- */}
      {!loading && !error && tasks.length > 0 && (
        <div className="planner-groups">
          <PlannerGroup
            title="Today’s tasks"
            tasks={todayTasks}
            empty="Nothing due today — enjoy the calm."
            {...cardProps}
          />
          <PlannerGroup
            title="Upcoming tasks"
            tasks={upcomingTasks}
            empty="No upcoming study sessions planned yet."
            {...cardProps}
          />
          <PlannerGroup
            title="Completed tasks"
            tasks={completedTasks}
            empty="Nothing completed yet — check one off to see it here."
            {...cardProps}
          />
        </div>
      )}
    </div>
  )
}

export default StudyPlannerPage
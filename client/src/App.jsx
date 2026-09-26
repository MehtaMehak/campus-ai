import { useEffect, useRef, useState } from 'react'
import NotesPage from './NotesPage.jsx'
import ResourcesPage from './ResourcesPage.jsx'
import AssignmentsPage from './AssignmentsPage.jsx'
import StudyPlannerPage from './StudyPlannerPage.jsx'
import AIAssistantPage from './AIAssistantPage.jsx'
import CoursesPage from './CoursesPage.jsx'
import LoginPage from './LoginPage.jsx'
import {
  fetchAssignments,
  fetchCourses,
  fetchNotes,
  fetchStudyTasks,
  getResources,
} from './api.js'
import { useAuth } from './auth-state.js'
import { Icon } from './Icon.jsx'
import { ACCENTS, dateKey, formatDate } from './ui.js'
import './App.css'

/* ============================================================
   Desk contents index (static navigation — the sections they
   open are all backed by live API data)
   ============================================================ */

const deskSections = [
  {
    title: 'Courses',
    description: 'Your enrolled courses and their materials.',
    icon: 'book',
    href: '#courses',
  },
  {
    title: 'Notes',
    description: 'Study notes, kept chapter by chapter.',
    icon: 'note',
    href: '#notes',
  },
  {
    title: 'Study Planner',
    description: 'Plan the week, keep the pace.',
    icon: 'calendar',
    href: '#planner',
  },
  {
    title: 'Resources',
    description: 'Papers, links and references.',
    icon: 'layers',
    href: '#resources',
  },
  {
    title: 'Assignments',
    description: 'Assignments, deadlines and progress.',
    icon: 'tasks',
    href: '#assignments',
  },
]

/* ============================================================
   App
   ============================================================ */

/* -------- URL hash ↔ page view (lightweight deep-linking) -------- */

// Hash → page view. Notes, Assignments, the Study Planner, the AI Assistant
// and Courses each have their own page. The remaining hashes (today,
// my-courses, …) belong to dashboard sections and map back to the dashboard
// itself, so they scroll to their spot on the Dashboard.
const HASH_VIEWS = {
  notes: 'notes',
  assignments: 'assignments',
  planner: 'planner',
  assistant: 'assistant',
  courses: 'courses',
  resources: 'resources',
}

// Which page should be open for the current URL hash? No hash (or any hash we
// don't recognise) opens the dashboard, so refresh and back/forward are never
// confusing. A query string after the page hash (e.g. "#notes?course=3") is
// allowed — the page view comes from the part before "?".
function viewFromHash() {
  const raw = window.location.hash.replace(/^#/, '')
  const key = raw.split('?')[0]
  return HASH_VIEWS[key] || 'dashboard'
}

function App() {
  // Signed-in user (null shows the login page) from the AuthProvider
  const { user, loading, logout } = useAuth()

  // Which page is visible: 'dashboard', 'notes', 'assignments', 'planner'
  // or 'assistant'. The initial view honours the URL hash (e.g. "#planner"),
  // so refreshing or opening a direct link lands on the right page.
  const [view, setView] = useState(viewFromHash)

  // Data from the APIs (each dashboard section fetches its own)
  const [courses, setCourses] = useState([])
  const [notes, setNotes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [studyTasks, setStudyTasks] = useState([])

  // Per-section loading + error, so one failed request never hides
  // the other sections of the dashboard
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [errorCourses, setErrorCourses] = useState('')
  const [errorNotes, setErrorNotes] = useState('')
  const [errorAssignments, setErrorAssignments] = useState('')
  const [loadingStudyTasks, setLoadingStudyTasks] = useState(true)
  const [errorStudyTasks, setErrorStudyTasks] = useState('')
  const [resources, setResources] = useState([])
  const [loadingResources, setLoadingResources] = useState(true)
  const [errorResources, setErrorResources] = useState('')

  // Bump this value to re-run the fetches (used by the Retry button)
  const [reloadKey, setReloadKey] = useState(0)

  // Create-form intents: set when the dashboard's Quick actions jump
  // straight into a page's create flow, cleared on normal navigation
  const [notesCreateIntent, setNotesCreateIntent] = useState(false)
  const [assignmentCreateIntent, setAssignmentCreateIntent] = useState(false)

  // A gentle, human date for the hero "Today" card
  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  // Fetch courses, notes and assignments independently, so a failure in
  // one section never breaks the rest of the dashboard. Nothing is fetched
  // while no one is logged in (and the effect re-runs once a user signs in,
  // so the dashboard boots with fresh data instead of 401 error states).
  useEffect(() => {
    if (!user) return

    async function loadCourses() {
      setLoadingCourses(true)
      try {
        const data = await fetchCourses()
        setCourses(data)
        setErrorCourses('')
      } catch (err) {
        setErrorCourses(err.message)
      } finally {
        setLoadingCourses(false)
      }
    }

    async function loadNotes() {
      setLoadingNotes(true)
      try {
        const data = await fetchNotes()
        setNotes(data)
        setErrorNotes('')
      } catch (err) {
        setErrorNotes(err.message)
      } finally {
        setLoadingNotes(false)
      }
    }

    async function loadAssignments() {
      setLoadingAssignments(true)
      try {
        const data = await fetchAssignments()
        setAssignments(data)
        setErrorAssignments('')
      } catch (err) {
        setErrorAssignments(err.message)
      } finally {
        setLoadingAssignments(false)
      }
    }

    async function loadStudyTasks() {
      setLoadingStudyTasks(true)
      try {
        const data = await fetchStudyTasks()
        setStudyTasks(data)
        setErrorStudyTasks('')
      } catch (err) {
        setErrorStudyTasks(err.message)
      } finally {
        setLoadingStudyTasks(false)
      }
    }

    // The shared refresh pipeline keeps resources on the same freshness
    // contract as the other dashboard sections: it is fetched whenever the
    // Dashboard loads, whenever Retry is pressed, and whenever the student
    // returns to the Dashboard (Step 33). The Recent resources panel consumes
    // this state (nothing is fetched on top of the existing effect).
    async function loadResources() {
      setLoadingResources(true)
      try {
        const data = await getResources()
        setResources(data)
        setErrorResources('')
      } catch (err) {
        setErrorResources(err.message)
      } finally {
        setLoadingResources(false)
      }
    }

    loadCourses()
    loadNotes()
    loadAssignments()
    loadStudyTasks()
    loadResources()
  }, [reloadKey, user])

  // Retry button: ask all sections to refetch
  function retry() {
    setReloadKey((key) => key + 1)
  }

  // The Dashboard keeps its data in App state, fetched whenever reloadKey
  // changes. Feature pages refresh their OWN lists after a mutation, so
  // returning to the Dashboard must trigger a refetch here — otherwise the
  // panels would keep showing the stale copies cached in App (Step 32).
  // If the logged-in user is already on the Dashboard, do nothing: the
  // initial fetch handled it, and the Retry button would go through `retry()`.
  const prevViewRef = useRef(view)
  useEffect(() => {
    const enteringDashboard = view === 'dashboard' && prevViewRef.current !== 'dashboard'
    prevViewRef.current = view
    if (enteringDashboard) {
      setReloadKey((key) => key + 1)
    }
  }, [view])

  /* -------- Derived dashboard data (from the live APIs) -------- */

  // Newest three notes
  const recentNotes = [...notes]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3)

  // Pending assignments, soonest due date first (no-date ones last)
  const pendingAssignments = assignments
    .filter((assignment) => assignment.status === 'Pending')
    .sort((a, b) => {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return new Date(a.due_date) - new Date(b.due_date)
    })

  const topPending = pendingAssignments.slice(0, 3)

  // The nearest pending deadline from today onwards
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const nextDeadline =
    pendingAssignments.find(
      (assignment) =>
        assignment.due_date && new Date(assignment.due_date) >= todayStart
    ) || null

  /* -------- Study planner data (from the live study-tasks API) -------- */

  // The user's local calendar day, e.g. "2026-09-24" — used for the "today"
  // comparison so UTC timestamps never shift a task to the wrong day.
  const todayKey = dateKey(new Date())

  // Tasks scheduled for the local day (today) — any status.
  const todaysStudyTasks = studyTasks.filter(
    (task) => task.study_date && dateKey(task.study_date) === todayKey
  )

  // Pending tasks with future study dates, soonest first.
  const upcomingStudyTasks = studyTasks
    .filter(
      (task) =>
        task.status === 'Pending' &&
        task.study_date &&
        dateKey(task.study_date) > todayKey
    )
    .sort((a, b) => dateKey(a.study_date).localeCompare(dateKey(b.study_date)))

  /* -------- Recent resources data (from the live resources API) -------- */

  // The API is already newest-first (created_at DESC, id DESC), so the panel
  // just takes the three most recent rows — no extra sort to maintain.
  const recentResources = resources.slice(0, 3)

  /* -------- Overdue assignments (from the live assignments API) -------- */

  // Past-deadline, not-completed assignments, oldest deadline first. Uses the
  // local calendar-day key (the same timezone-safe convention as the
  // study-task panels) so a due date is compared as a calendar day and never
  // shifts by a day because of a UTC/tz conversion. Assignments without a
  // deadline can never be overdue.
  const overdueAssignments = assignments
    .filter(
      (assignment) =>
        assignment.due_date &&
        dateKey(assignment.due_date) < todayKey &&
        assignment.status !== 'Completed'
    )
    .sort((a, b) => dateKey(a.due_date).localeCompare(dateKey(b.due_date)))
    .slice(0, 3)

  /* -------- Simple view switching (no router package needed) --------
   Navigation is handled by the URL hash: every link above is a plain
   <a href="#..."> anchor, and the hashchange listener maps that hash to
   a view. The functions below are only for actions that ALSO need to set
   extra state before navigating (opening a create form from the dashboard).
   -------- */

  // Open the Notes page with its create form showing
  function quickAddNote() {
    setNotesCreateIntent(true)
    setView('notes')
    window.location.hash = 'notes'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Open the Assignments page with its create form showing
  function quickAddAssignment() {
    setAssignmentCreateIntent(true)
    setView('assignments')
    window.location.hash = 'assignments'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Native hash navigation means a click whose target hash ALREADY equals the
  // current URL fires NO hashchange event (the browser treats it as a no-op).
  // Without this, clicking e.g. "Dashboard" while already on #dashboard would
  // do nothing at all. This helper re-runs the intent of such clicks so every
  // click gives feedback (scroll to top, or to the dashboard section).
  function handleAlreadyCurrentTab(event) {
    const href = event.currentTarget.getAttribute('href') || ''
    // If the hash will change, the hashchange listener below does the work.
    if (window.location.hash !== href) return
    const key = href.slice(1)
    if (key && key !== 'dashboard') {
      setTimeout(() => {
        document.getElementById(key)?.scrollIntoView({ behavior: 'smooth' })
      }, 60)
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // The URL hash is the single source of truth for which page is open.
  // Header links are plain <a href="#..."> anchors, so clicking one changes
  // the URL natively (even if a React handler ever failed), and this
  // listener turns every hash change into a view change. Refresh,
  // back/forward and direct links all work because the initial view reads
  // the hash too (useState(viewFromHash)).
  useEffect(() => {
    function handleHashChange() {
      const raw = window.location.hash.replace(/^#/, '')
      const key = raw.split('?')[0]
      const next = HASH_VIEWS[key] || 'dashboard'
      setView(next)

      if (next !== 'dashboard') {
        // Notes / Assignments / Planner / Assistant / Courses open at the top
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (key && key !== 'dashboard') {
        // A dashboard section hash (today, my-courses, …) scrolls to its spot
        setTimeout(() => {
          document.getElementById(key)?.scrollIntoView({ behavior: 'smooth' })
        }, 60)
      } else {
        // The plain Dashboard link / brand start at the very top
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Initials for the avatar, e.g. "Aarav Singh" → "AS"
  const initials =
    String(user?.name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => (part[0] || '').toUpperCase())
      .join('') || '?'

  // While the session is being restored from the cookie, show a quiet splash.
  if (loading) {
    return (
      <div className="app">
        <header className="site-header">
          <div className="header-inner">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true">
                <Icon name="cap" />
              </span>
              <span className="brand-wordmark">
                Campus <em>AI</em>
              </span>
            </span>
          </div>
        </header>
        <main className="main">
          <div className="auth-splash" role="status">
            <p className="kicker">Loading your desk</p>
          </div>
        </main>
        <footer className="footer">
          <span className="footer-brand">
            Campus <em>AI</em>
          </span>
          <span className="footer-note">A study desk for modern students · 2026</span>
        </footer>
      </div>
    )
  }

  // No signed-in user → the login / signup card, with a slim brand header.
  if (!user) {
    return (
      <div className="app">
        <header className="site-header">
          <div className="header-inner">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true">
                <Icon name="cap" />
              </span>
              <span className="brand-wordmark">
                Campus <em>AI</em>
              </span>
            </span>
          </div>
        </header>
        <main className="main">
          <LoginPage />
        </main>
        <footer className="footer">
          <span className="footer-brand">
            Campus <em>AI</em>
          </span>
          <span className="footer-note">A study desk for modern students · 2026</span>
        </footer>
      </div>
    )
  }

  return (
    <div className="app">
      {/* ================= Header ================= */}
      <header className="site-header">
        <div className="header-inner">
          <a
            href="#dashboard"
            className="brand"
            onClick={handleAlreadyCurrentTab}
          >
            <span className="brand-mark" aria-hidden="true">
              <Icon name="cap" />
            </span>
            <span className="brand-wordmark">
              Campus <em>AI</em>
            </span>
          </a>

          <nav className="nav" aria-label="Main navigation">
            <a
              href="#dashboard"
              className={`nav-link ${view === 'dashboard' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              Dashboard
            </a>
            <a
              href="#courses"
              className={`nav-link ${view === 'courses' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              Courses
            </a>
            <a
              href="#assignments"
              className={`nav-link ${view === 'assignments' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              Assignments
            </a>
            <a
              href="#planner"
              className={`nav-link ${view === 'planner' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              Planner
            </a>
            <a
              href="#assistant"
              className={`nav-link ${view === 'assistant' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              AI Assistant
            </a>
            <a
              href="#notes"
              className={`nav-link ${view === 'notes' ? 'is-current' : ''}`}
              onClick={(event) => {
                setNotesCreateIntent(false)
                handleAlreadyCurrentTab(event)
              }}
            >
              Notes
            </a>
            <a
              href="#resources"
              className={`nav-link ${view === 'resources' ? 'is-current' : ''}`}
              onClick={handleAlreadyCurrentTab}
            >
              Resources
            </a>
            <a
              href="#today"
              className="nav-link"
              onClick={handleAlreadyCurrentTab}
            >
              Today
            </a>
          </nav>

          <div className="profile">
            <span className="profile-avatar" aria-hidden="true">{initials}</span>
            <div className="profile-info">
              <span className="profile-name">{user.name}</span>
              <span className="profile-role">Student</span>
            </div>
            <button
              type="button"
              className="profile-logout"
              onClick={logout}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ================= Main ================= */}
      <main className="main">
        {view === 'notes' ? (
          /* -------- Notes page -------- */
          <NotesPage
            createOnMount={notesCreateIntent}
            onNoteCreated={() => retry()}
          />
        ) : view === 'assignments' ? (
          /* -------- Assignments page -------- */
          <AssignmentsPage createOnMount={assignmentCreateIntent} />
        ) : view === 'assistant' ? (
          /* -------- AI Assistant page -------- */
          <AIAssistantPage />
        ) : view === 'planner' ? (
          /* -------- Study Planner page -------- */
          <StudyPlannerPage />
        ) : view === 'resources' ? (
          /* -------- Resources page -------- */
          <ResourcesPage />
        ) : view === 'courses' ? (
          /* -------- Courses page -------- */
          <CoursesPage />
        ) : (
          <>
            {/* -------- Hero -------- */}
            <section className="hero">
              <div className="hero-copy">
                <p className="kicker">Campus AI — your student desk</p>
                <h1 className="hero-title">
                  Your campus,<br />
                  <em>organised.</em>
                </h1>
                <p className="hero-lede">
                  Courses, notes, resources and your study plan — all in one place.
                </p>
                <div className="hero-actions">
                  <a
                    href="#courses"
                    className="btn btn-primary"
                    onClick={handleAlreadyCurrentTab}
                  >
                    Explore courses
                    <Icon name="arrow" />
                  </a>
                  <a
                    href="#today"
                    className="btn-link"
                    onClick={handleAlreadyCurrentTab}
                  >
                    See today’s desk
                  </a>
                </div>
              </div>

              {/* A small editorial “Today” index card — visual detail only */}
              <aside className="scene" aria-hidden="true">
                <span className="scene-dots" />
                <div className="scene-card scene-card--back" />
                <div className="scene-card scene-card--front">
                  <span className="scene-tab" />
                  <span className="scene-kicker">Today</span>
                  <span className="scene-date">{todayLabel}</span>
                  <ul className="scene-list">
                    <li>Draft essay outline</li>
                    <li>Revise Unit 2 notes</li>
                    <li>Read Chapter 4</li>
                  </ul>
                  <span className="scene-signature">
                    Study plan · updated 8:40 am
                  </span>
                </div>
              </aside>
            </section>

            {/* -------- Quick access (editorial index) -------- */}
            <section className="section" id="quick-access">
              <div className="section-head">
                <p className="kicker">Contents</p>
                <h2>Your desk, at a glance</h2>
              </div>

              <div className="index-list">
                {deskSections.map((item, i) => (
                  <a
                    key={item.title}
                    href={item.href}
                    className="index-row"
                    onClick={(event) => {
                      if (item.href === '#notes') setNotesCreateIntent(false)
                      else if (item.href === '#assignments')
                        setAssignmentCreateIntent(false)
                      handleAlreadyCurrentTab(event)
                    }}
                  >
                    <span className="index-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="index-icon">
                      <Icon name={item.icon} />
                    </span>
                    <span className="index-copy">
                      <span className="index-title">{item.title}</span>
                      <span className="index-desc">{item.description}</span>
                    </span>
                    <span className="index-arrow">
                      <Icon name="arrow" />
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* -------- My Courses recap (real API data; the full page lives at #courses) -------- */}
            <section className="section" id="my-courses">
              <div className="section-head">
                <p className="kicker">Enrolled</p>
                <h2>My courses</h2>
                {!loadingCourses && !errorCourses && courses.length > 0 && (
                  <span className="tag">{courses.length} courses</span>
                )}
              </div>

              {/* Loading state */}
              {loadingCourses && (
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

              {/* Error state */}
              {!loadingCourses && errorCourses && (
                <div className="error-panel" role="alert">
                  <Icon name="alert" className="icon--lg error-icon" />
                  <div className="error-copy">
                    <p className="error-title">The course directory is unreachable</p>
                    <p className="error-detail">{errorCourses}</p>
                    <p className="error-hint">
                      Make sure the backend is running on port 5000, then try again.
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary retry" onClick={retry}>
                    Try again
                  </button>
                </div>
              )}

              {/* Empty state (backend is up but has no courses) */}
              {!loadingCourses && !errorCourses && courses.length === 0 && (
                <p className="status-message">
                  Your course list is empty for now. Check back after enrolment.
                </p>
              )}

              {/* Course cards from the real API */}
              {!loadingCourses && !errorCourses && courses.length > 0 && (
                <div className="course-grid">
                  {courses.map((course) => {
                    const accent = ACCENTS[course.id % ACCENTS.length]
                    return (
                      <article className="course-card" key={course.id}>
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
                        <div className="course-card-foot">
                          <span className="course-status">
                            <span className="status-dot" aria-hidden="true" />
                            Enrolled
                          </span>
                          <a
                            href="#courses"
                            className="course-link"
                            onClick={() => {
                              // Reuse the Courses page's existing open-course
                              // mechanism: remember THIS card's course before
                              // navigating, so #courses opens that exact
                              // course's detail (CoursesPage restores the id
                              // from sessionStorage when it mounts).
                              sessionStorage.setItem(
                                'campus-open-course-id',
                                String(course.id)
                              )
                            }}
                          >
                            View course
                            <Icon name="arrow" />
                          </a>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            {/* -------- Today: live data from the APIs -------- */}
            <section className="section" id="today">
              <div className="section-head">
                <p className="kicker">Today</p>
                <h2>At a glance</h2>
                <span className="tag">Live data</span>
              </div>

              {/* Quick actions — jump straight into a create form */}
              <div className="quick-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={quickAddNote}
                >
                  <Icon name="note" className="icon--sm" />
                  Add note
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={quickAddAssignment}
                >
                  <Icon name="tasks" className="icon--sm" />
                  Add assignment
                </button>
              </div>

              <div className="today-panel">
                {/* -------- Recent notes (3 newest) -------- */}
                <div className="today-col">
                  <div className="today-label-row">
                    <p className="today-label">Recent notes</p>
                    <a className="today-view-all" href="#notes">View all</a>
                  </div>

                  {loadingNotes && (
                    <div className="today-loading" role="status" aria-label="Loading recent notes">
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingNotes && errorNotes && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Notes are unavailable</p>
                      <p className="today-error-detail">{errorNotes}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingNotes && !errorNotes && recentNotes.length === 0 && (
                    <p className="today-empty">
                      No notes yet — add your first from the{' '}
                      <a className="today-empty-link" href="#notes">
                        Notes page
                      </a>
                      .
                    </p>
                  )}

                  {!loadingNotes && !errorNotes && recentNotes.length > 0 && (
                    <ul className="today-list">
                      {recentNotes.map((note) => (
                        <li className="today-item" key={note.id}>
                          <a className="today-item-link" href="#notes">
                            <span className="today-item-icon">
                              <Icon name="note" />
                            </span>
                            <span className="today-item-copy">
                              <span className="today-item-text">{note.title}</span>
                              <span className="today-item-meta">
                                {note.course_code} · {note.course_name} ·{' '}
                                {formatDate(note.created_at)}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* -------- Upcoming deadline (nearest pending) -------- */}
                <div className="today-col">
                  <div className="today-label-row">
                    <p className="today-label">Upcoming deadline</p>
                    <a className="today-view-all" href="#assignments">
                      View all
                    </a>
                  </div>

                  {loadingAssignments && (
                    <div className="today-loading" role="status" aria-label="Loading deadline">
                      <span className="skeleton skeleton-line w-80" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingAssignments && errorAssignments && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Deadlines are unavailable</p>
                      <p className="today-error-detail">{errorAssignments}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingAssignments && !errorAssignments && !nextDeadline && (
                    <p className="today-empty">
                      No upcoming deadlines — enjoy the calm while it lasts.
                    </p>
                  )}

                  {!loadingAssignments && !errorAssignments && nextDeadline && (
                    <a className="deadline-card" href="#assignments">
                      <p className="kicker">Nearest</p>
                      <h3 className="deadline-title">{nextDeadline.title}</h3>
                      <p className="deadline-meta">
                        <span className="deadline-date">
                          Due {formatDate(nextDeadline.due_date)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {nextDeadline.course_code} — {nextDeadline.course_name}
                        </span>
                      </p>
                    </a>
                  )}
                </div>

                {/* -------- Pending assignments (3 soonest) -------- */}
                <div className="today-col">
                  <div className="today-label-row">
                    <p className="today-label">Pending assignments</p>
                    <a className="today-view-all" href="#assignments">
                      View all
                    </a>
                  </div>

                  {loadingAssignments && (
                    <div className="today-loading" role="status" aria-label="Loading assignments">
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingAssignments && errorAssignments && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Assignments are unavailable</p>
                      <p className="today-error-detail">{errorAssignments}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingAssignments && !errorAssignments && topPending.length === 0 && (
                    <p className="today-empty">
                      No pending assignments — you’re all caught up.
                    </p>
                  )}

                  {!loadingAssignments && !errorAssignments && topPending.length > 0 && (
                    <ul className="today-list">
                      {topPending.map((assignment) => (
                        <li className="today-item" key={assignment.id}>
                          <a
                            className="today-item-link"
                            href="#assignments"
                          >
                            <span className="today-item-icon">
                              <Icon name="tasks" />
                            </span>
                            <span className="today-item-copy">
                              <span className="today-item-text">
                                {assignment.title}
                              </span>
                              <span className="today-item-meta">
                                {assignment.course_code} · Due{' '}
                                {assignment.due_date
                                  ? formatDate(assignment.due_date)
                                  : 'no date'}{' '}
                                · {assignment.status}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* -------- Study planner preview: live study tasks -------- */}
            <section className="section" id="study-tasks">
              <div className="section-head">
                <p className="kicker">Study planner</p>
                <h2>Today’s study tasks</h2>
                {!loadingStudyTasks && !errorStudyTasks && todaysStudyTasks.length > 0 && (
                  <span className="tag">{todaysStudyTasks.length} today</span>
                )}
              </div>

              <div className="today-panel today-panel--two">
                {/* -------- Tasks scheduled for the local day -------- */}
                <div className="today-col">
                  <div className="today-label-row">
                    <p className="today-label">Today’s study tasks</p>
                    <a className="today-view-all" href="#planner">
                      View all
                    </a>
                  </div>

                  {loadingStudyTasks && (
                    <div
                      className="today-loading"
                      role="status"
                      aria-label="Loading study tasks"
                    >
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingStudyTasks && errorStudyTasks && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Study tasks are unavailable</p>
                      <p className="today-error-detail">{errorStudyTasks}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingStudyTasks && !errorStudyTasks && todaysStudyTasks.length === 0 && (
                    <p className="today-empty">
                      No study tasks for today — plan your week from the{' '}
                      <a className="today-empty-link" href="#planner">
                        Study Planner
                      </a>
                      .
                    </p>
                  )}

                  {!loadingStudyTasks && !errorStudyTasks && todaysStudyTasks.length > 0 && (
                    <ul className="today-list">
                      {todaysStudyTasks.map((task) => (
                        <li className="today-item" key={task.id}>
                          <a className="today-item-link" href="#planner">
                            <span className="today-item-icon">
                              <Icon name="calendar" />
                            </span>
                            <span className="today-item-copy">
                              <span className="today-item-text">{task.title}</span>
                              <span className="today-item-meta">
                                {task.course_code} — {task.course_name}
                              </span>
                              <span className="today-item-meta">
                                {task.priority} priority · {task.status}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* -------- Pending tasks with future study dates -------- */}
                <div className="today-col">
                  <div className="today-label-row">
                    <p className="today-label">Upcoming study tasks</p>
                    <a className="today-view-all" href="#planner">
                      View all
                    </a>
                  </div>

                  {loadingStudyTasks && (
                    <div
                      className="today-loading"
                      role="status"
                      aria-label="Loading study tasks"
                    >
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingStudyTasks && errorStudyTasks && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Study tasks are unavailable</p>
                      <p className="today-error-detail">{errorStudyTasks}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingStudyTasks && !errorStudyTasks && upcomingStudyTasks.length === 0 && (
                    <p className="today-empty">
                      No upcoming study sessions planned yet.
                    </p>
                  )}

                  {!loadingStudyTasks && !errorStudyTasks && upcomingStudyTasks.length > 0 && (
                    <ul className="today-list">
                      {upcomingStudyTasks.map((task) => (
                        <li className="today-item" key={task.id}>
                          <a className="today-item-link" href="#planner">
                            <span className="today-item-icon">
                              <Icon name="calendar" />
                            </span>
                            <span className="today-item-copy">
                              <span className="today-item-text">{task.title}</span>
                              <span className="today-item-meta">
                                {task.course_code} — {task.course_name}
                              </span>
                              <span className="today-item-meta">
                                {formatDate(task.study_date)} · {task.priority}{' '}
                                priority · {task.status}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* -------- Recent resources preview (live resources API data) --------
                Cross-course snapshot of the user's three most recent resources.
                Every path from here goes to #resources (the resource detail is a
                card on that page, not a separate route). The panel re-fetches
                through the same shared effect as the other sections, so edits
                made on the Resources page show up on return without a reload. */}
            <section className="section" id="recent-resources">
              <div className="section-head">
                <p className="kicker">Resources</p>
                <h2>Recent resources</h2>
                {!loadingResources && !errorResources && resources.length > 0 && (
                  <span className="tag">
                    {resources.length} {resources.length === 1 ? 'resource' : 'resources'}
                  </span>
                )}
              </div>

              <div className="today-panel">
                <div className="today-col today-col--wide">
                  <div className="today-label-row">
                    <p className="today-label">Recent resources</p>
                    <a className="today-view-all" href="#resources">
                      View all
                    </a>
                  </div>

                  {loadingResources && (
                    <div className="today-loading" role="status" aria-label="Loading recent resources">
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingResources && errorResources && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Resources are unavailable</p>
                      <p className="today-error-detail">{errorResources}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingResources && !errorResources && recentResources.length === 0 && (
                    <p className="today-empty">
                      No resources yet — add your first from the{' '}
                      <a className="today-empty-link" href="#resources">
                        Resources page
                      </a>
                      .
                    </p>
                  )}

                  {!loadingResources && !errorResources && recentResources.length > 0 && (
                    <ul className="today-list">
                      {recentResources.map((resource) => (
                        <li className="today-item" key={resource.id}>
                          <a className="today-item-link" href="#resources">
                            <span className="today-item-icon">
                              <Icon name="layers" />
                            </span>
                            <span className="today-item-copy">
                              <span className="today-item-text">{resource.title}</span>
                              <span className="today-item-meta">
                                {resource.course_code} — {resource.course_name}
                              </span>
                              <span className="today-item-meta">
                                {resource.resource_type} · {formatDate(resource.created_at)}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* -------- Overdue assignments (live assignments API data) --------
                Past-deadline, not-completed assignments with the oldest
                deadline first. Rows navigate to #assignments (assignment
                details live on that page, not a separate route). The panel
                rides the shared Step 33 dashboard effect, so create / edit /
                status / delete changes made on the Assignments page show up
                on return without a reload. */}
            <section className="section" id="overdue-assignments">
              <div className="section-head">
                <p className="kicker">Assignments</p>
                <h2>Overdue assignments</h2>
                {!loadingAssignments && !errorAssignments && overdueAssignments.length > 0 && (
                  <span className="tag">
                    {overdueAssignments.length}{' '}
                    {overdueAssignments.length === 1
                      ? 'overdue assignment'
                      : 'overdue assignments'}
                  </span>
                )}
              </div>

              <div className="today-panel">
                <div className="today-col today-col--wide">
                  <div className="today-label-row">
                    <p className="today-label">Overdue assignments</p>
                    <a className="today-view-all" href="#assignments">
                      View all
                    </a>
                  </div>

                  {loadingAssignments && (
                    <div className="today-loading" role="status" aria-label="Loading overdue assignments">
                      <span className="skeleton skeleton-line w-70" />
                      <span className="skeleton skeleton-line w-95" />
                      <span className="skeleton skeleton-line w-60" />
                    </div>
                  )}

                  {!loadingAssignments && errorAssignments && (
                    <div className="today-error" role="alert">
                      <p className="today-error-title">Deadlines are unavailable</p>
                      <p className="today-error-detail">{errorAssignments}</p>
                      <button type="button" className="today-retry" onClick={retry}>
                        Try again
                      </button>
                    </div>
                  )}

                  {!loadingAssignments &&
                    !errorAssignments &&
                    overdueAssignments.length === 0 && (
                      <p className="today-empty">
                        No overdue assignments — check the{' '}
                        <a className="today-empty-link" href="#assignments">
                          Assignments page
                        </a>{' '}
                        for what’s coming up.
                      </p>
                    )}

                  {!loadingAssignments &&
                    !errorAssignments &&
                    overdueAssignments.length > 0 && (
                      <ul className="today-list">
                        {overdueAssignments.map((assignment) => (
                          <li className="today-item" key={assignment.id}>
                            <a className="today-item-link" href="#assignments">
                              <span className="today-item-icon">
                                <Icon name="tasks" />
                              </span>
                              <span className="today-item-copy">
                                <span className="today-item-text">
                                  {assignment.title}
                                </span>
                                <span className="today-item-meta">
                                  {assignment.course_code} — {assignment.course_name} · Due{' '}
                                  {formatDate(assignment.due_date)}
                                </span>
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* ================= Footer ================= */}
      <footer className="footer">
        <span className="footer-brand">Campus <em>AI</em></span>
        <span className="footer-note">A study desk for modern students · 2026</span>
      </footer>
    </div>
  )
}

export default App
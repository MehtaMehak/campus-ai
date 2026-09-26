import { useEffect, useState } from 'react'
import { createNote, deleteNote, fetchCourses, fetchNotes, updateNote } from './api.js'
import CourseFilterBanner from './CourseFilterBanner.jsx'
import { Icon } from './Icon.jsx'
import { ACCENTS, courseIdFromHash, formatDate } from './ui.js'
import { useCourseFilter } from './useCourseFilter.js'

function NotesPage({ createOnMount = false, onNoteCreated }) {
  // Notes + courses from the backend
  const [notes, setNotes] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Bump this value to re-run the fetch (used by Retry and after saving)
  const [reloadKey, setReloadKey] = useState(0)

  // Create-note form state (opens straight away when the dashboard's
  // "Add note" quick action sent the user here)
  const [formOpen, setFormOpen] = useState(createOnMount)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  // Starts at the filtered course when the student arrived from a course's
  // "View all notes" (#notes?course=…) — kept in sync by useCourseFilter's
  // onFilterChange callback.
  const [courseId, setCourseId] = useState(() => {
    const id = courseIdFromHash()
    return id ? String(id) : ''
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  // Client-side search over the notes currently loaded (title + content).
  // Purposely local state only — the query is not put into the URL/hash.
  const [searchQuery, setSearchQuery] = useState('')
  // Delete action state (mirrors AssignmentsPage: busy id + action error)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  // Edit draft state — separate from the create-form fields so entering edit
  // mode never overwrites the hash-synced course default (courseId). While an
  // edit is active, the form binds to this draft instead of the create fields.
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCourseId, setEditCourseId] = useState('')

  // Shared course filter from the hash (#notes?course=ID). The hook reads the
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
    baseView: 'notes',
    onFilterChange: (id) => setCourseId(id ? String(id) : ''),
  })

  // Load notes + courses from the real backend. The notes request carries the
  // active course filter, so a filtered page only ever fetches that course's
  // notes (the backend still scopes everything to the logged-in user).
  useEffect(() => {
    async function load() {
      try {
        const [notesData, coursesData] = await Promise.all([
          fetchNotes(courseFilterId),
          fetchCourses(),
        ])
        setNotes(notesData)
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

  // Drop any in-progress edit and its draft values
  function exitEdit() {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
    setEditCourseId('')
  }

  function toggleForm() {
    const next = !formOpen
    setFormOpen(next)
    if (!next) exitEdit()
    setSaveError('')
  }

  // Enter edit mode: reuse the create-note form, pre-filled from the note.
  // Draft values live in separate edit state, so the create form's course
  // default (kept in sync with the hash filter) is never clobbered.
  function handleEdit(note) {
    setFormOpen(true)
    setEditingId(note.id)
    setEditTitle(note.title)
    setEditContent(note.content)
    setEditCourseId(String(note.course_id))
    setSaveError('')
    setSuccessMessage('')
  }

  // Save the note (create or edit) to the backend, then refresh the list
  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')

    try {
      if (editingId !== null) {
        await updateNote(editingId, {
          title: editTitle,
          content: editContent,
          course_id: Number(editCourseId),
        })
      } else {
        await createNote({
          title,
          content,
          course_id: Number(courseId),
        })

        // Let the App shell know a note was created so the Dashboard's
        // "Recent notes" preview refreshes too (optional callback).
        onNoteCreated?.()

        // Create-only reset: the edit flow must not touch the hash-synced
        // course default (courseId), so "Create note" still respects the
        // active course context after an edit.
        setCourseId('')
      }

      // Success: confirm to the user, close the form, refresh the notes
      setSuccessMessage(editingId !== null ? 'Changes saved' : 'Note saved successfully')
      setTitle('')
      setContent('')
      setFormOpen(false)
      exitEdit()
      setReloadKey((key) => key + 1)

      // Let the success message fade out on its own
      setTimeout(() => setSuccessMessage(''), 4000)
    } catch (err) {
      // Stay in the form (and in edit mode) so the draft can be fixed/retried
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Remove a note, then refresh. The refetch keeps the current course filter
  // (?course=ID is part of the fetch) and the search query untouched — search
  // is re-applied to the refreshed list automatically.
  async function handleDelete(note) {
    setDeleteBusyId(note.id)
    setActionError('')

    try {
      await deleteNote(note.id)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t delete “${note.title}”: ${err.message}`)
    } finally {
      setDeleteBusyId(null)
    }
  }

  // Validation uses whichever field set the form is currently bound to
  const canSave =
    editingId !== null
      ? editTitle.trim() !== '' && editContent.trim() !== '' && editCourseId !== ''
      : title.trim() !== '' && content.trim() !== '' && courseId !== ''

  // Search runs AFTER the backend's ?course= filter: `notes` already only
  // holds the current course context, so narrowing it client-side leaves the
  // course filtering untouched. Empty/whitespace query → show everything.
  const q = searchQuery.trim().toLowerCase()
  const filteredNotes = q
    ? notes.filter(
        (note) =>
          (note.title || '').toLowerCase().includes(q) ||
          (note.content || '').toLowerCase().includes(q)
      )
    : notes

  return (
    <div className="notes-page">
      {/* -------- Heading + create button -------- */}
      <div className="section-head">
        <p className="kicker">Notes</p>
        <h2>Study notes</h2>
        <div className="section-head-actions">
          {!loading && !error && notes.length > 0 && (
            <span className="tag">{notes.length} notes</span>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={toggleForm}
          >
            {formOpen ? 'Close form' : 'Create note'}
          </button>
        </div>
      </div>

      {/* -------- Course-context banner (opened from a course's "View all notes") -------- */}
      {/* Gated on ready (!loading) so the course name is always available for the label. */}
      {ready && courseFilterId && (
        <CourseFilterBanner
          itemLabel="Notes"
          course={filterCourse}
          courseId={courseFilterId}
          accent={filterAccent}
          clearHref={clearHref}
          clearText="View all notes"
          clearAriaLabel="Clear course filter — show all notes"
        />
      )}

      {/* -------- Success banner -------- */}
      {successMessage && (
        <p className="form-success" role="status">
          ✓ {successMessage}
        </p>
      )}

      {/* -------- Create / edit note form -------- */}
      {formOpen && (
        <form className="note-form" onSubmit={handleSave}>
          <h3 className="form-title">
            {editingId !== null ? 'Edit note' : 'Create note'}
          </h3>

          <div className="field">
            <label htmlFor="note-title">Title</label>
            <input
              id="note-title"
              type="text"
              placeholder="e.g. Vectors and matrices"
              value={editingId !== null ? editTitle : title}
              onChange={(e) =>
                editingId !== null ? setEditTitle(e.target.value) : setTitle(e.target.value)
              }
              required
            />
          </div>

          <div className="field">
            <label htmlFor="note-content">Content</label>
            <textarea
              id="note-content"
              rows="5"
              placeholder="Write your note here…"
              value={editingId !== null ? editContent : content}
              onChange={(e) =>
                editingId !== null ? setEditContent(e.target.value) : setContent(e.target.value)
              }
              required
            />
          </div>

          <div className="field">
            <label htmlFor="note-course">Course</label>
            <select
              id="note-course"
              value={editingId !== null ? editCourseId : courseId}
              onChange={(e) =>
                editingId !== null ? setEditCourseId(e.target.value) : setCourseId(e.target.value)
              }
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

          {saveError && <p className="form-error">⚠️ {saveError}</p>}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSave || saving}
            >
              {saving
                ? 'Saving…'
                : editingId !== null
                  ? 'Save changes'
                  : 'Save note'}
            </button>
            <button type="button" className="btn-link" onClick={toggleForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* -------- Error from a delete -------- */}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {/* -------- Search (narrows the notes already visible in this course context) -------- */}
      {!loading && !error && notes.length > 0 && (
        <div className="notes-search">
          <label className="notes-search-label" htmlFor="note-search">
            Search notes
          </label>
          <input
            id="note-search"
            className="notes-search-input"
            type="search"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* -------- Loading -------- */}
      {loading && (
        <div className="note-grid" role="status" aria-label="Loading notes">
          {[1, 2, 3].map((n) => (
            <div className="note-skeleton" key={n}>
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
            <p className="error-title">Couldn’t load your notes</p>
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
      {!loading && !error && notes.length === 0 && (
        <p className="status-message">
          {courseFilterId
            ? 'No notes for this course yet — tap “Create note” to add one.'
            : 'No notes yet — tap “Create note” to add your first one.'}
        </p>
      )}

      {/* -------- Search found nothing (notes exist, but none match) -------- */}
      {!loading && !error && notes.length > 0 && filteredNotes.length === 0 && (
        <p className="status-message">
          No notes found for “{searchQuery.trim()}”.{' '}
          <span className="status-hint">Try a different search.</span>
        </p>
      )}

      {/* -------- Notes list (real database data, narrowed by search) -------- */}
      {!loading && !error && filteredNotes.length > 0 && (
        <div className="note-grid">
          {filteredNotes.map((note) => {
            const accent = ACCENTS[note.course_id % ACCENTS.length]
            return (
              <article className="note-card" key={note.id}>
                <div className="note-card-top">
                  <span className="note-index">
                    {String(note.id).padStart(2, '0')}
                  </span>
                  <span className="note-date">{formatDate(note.created_at)}</span>
                </div>
                <h3 className="note-title">{note.title}</h3>
                <p className="note-preview">{note.content}</p>
                <div className="note-card-foot">
                  <span
                    className="course-chip"
                    style={{
                      color: accent.color,
                      backgroundColor: accent.wash,
                      borderColor: accent.line,
                    }}
                  >
                    {note.course_code}
                  </span>
                  <span className="note-course-name">{note.course_name}</span>
                  <div className="note-actions">
                    <button
                      type="button"
                      className="note-action"
                      onClick={() => handleEdit(note)}
                      disabled={deleteBusyId === note.id}
                    >
                      <Icon name="pencil" className="icon--sm" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="note-action note-action--danger"
                      onClick={() => handleDelete(note)}
                      disabled={deleteBusyId === note.id}
                    >
                      <Icon name="trash" className="icon--sm" />
                      {deleteBusyId === note.id ? 'Deleting…' : 'Delete'}
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

export default NotesPage
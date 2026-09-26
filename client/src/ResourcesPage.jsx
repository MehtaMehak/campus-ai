import { useEffect, useState } from 'react'
import { createResource, deleteResource, fetchCourses, getResources, updateResource } from './api.js'
import CourseFilterBanner from './CourseFilterBanner.jsx'
import { Icon } from './Icon.jsx'
import { ACCENTS, courseIdFromHash, formatDate } from './ui.js'
import { useCourseFilter } from './useCourseFilter.js'

// The V1 resource kinds — must match the backend's accepted values exactly
const RESOURCE_TYPES = ['Link', 'Video', 'Article', 'PDF']

function ResourcesPage({ createOnMount = false }) {
  // Resources + courses from the backend
  const [resources, setResources] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Bump this value to re-run the fetch (used by Retry and after saving)
  const [reloadKey, setReloadKey] = useState(0)

  // Create-resource form state (opens straight away when a caller requested it)
  const [formOpen, setFormOpen] = useState(createOnMount)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [resourceType, setResourceType] = useState('Link')
  // Starts at the filtered course when the student arrived from a course's
  // "View resources" (#resources?course=…) — kept in sync by useCourseFilter's
  // onFilterChange callback.
  const [courseId, setCourseId] = useState(() => {
    const id = courseIdFromHash()
    return id ? String(id) : ''
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  // Edit draft state — separate from the create-form fields so entering edit
  // mode never overwrites the hash-synced course default (courseId). While an
  // edit is active, the form binds to this draft instead of the create fields.
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editResourceType, setEditResourceType] = useState('Link')
  const [editCourseId, setEditCourseId] = useState('')
  // Delete action state (mirrors NotesPage: busy id + action error)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  // Client-side search over the resources currently loaded (title, description,
  // URL, type, course name/code). Purposely local state only — the query is
  // not put into the URL/hash.
  const [searchQuery, setSearchQuery] = useState('')

  // Shared course filter from the hash (#resources?course=ID). The hook reads
  // the hash, keeps courseFilterId in sync (deep links, header nav, back/
  // forward, the banner's "clear") and resolves the selected course from the
  // catalog for the banner. onFilterChange keeps the create form's default
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
    baseView: 'resources',
    onFilterChange: (id) => setCourseId(id ? String(id) : ''),
  })

  // Load resources + courses from the real backend. The resources request
  // carries the active course filter, so a filtered page only ever fetches
  // that course's resources (the backend still scopes everything to the
  // logged-in user).
  useEffect(() => {
    async function load() {
      try {
        const [resourcesData, coursesData] = await Promise.all([
          getResources(courseFilterId),
          fetchCourses(),
        ])
        setResources(resourcesData)
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

  function exitEdit() {
    setEditingId(null)
    setEditTitle('')
    setEditDescription('')
    setEditUrl('')
    setEditResourceType('Link')
    setEditCourseId('')
  }

  function toggleForm() {
    const next = !formOpen
    setFormOpen(next)
    if (!next) exitEdit()
    setSaveError('')
  }

  // Enter edit mode: reuse the create-resource form, pre-filled from the
  // resource being edited. Draft values live in separate edit state, so the
  // create form's course default (kept in sync with the hash filter) is never
  // overwritten while an edit is in progress.
  function handleEdit(resource) {
    setFormOpen(true)
    setEditingId(resource.id)
    setEditTitle(resource.title)
    setEditDescription(resource.description || '')
    setEditUrl(resource.url)
    setEditResourceType(resource.resource_type)
    setEditCourseId(String(resource.course_id))
    setSaveError('')
    setSuccessMessage('')
  }

  // Save the new resource to the backend, then refresh the list. A successful
  // save never touches the hash-synced course default (courseId) except to
  // clear it for the next fresh create — the active course context comes back
  // through onFilterChange whenever the filter changes.
  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')

    try {
      if (editingId !== null) {
        // Edit mode: update the existing resource (empty description sends an
        // empty string so the backend can clear it to null).
        await updateResource(editingId, {
          title: editTitle,
          description: editDescription.trim(),
          url: editUrl,
          resource_type: editResourceType,
          course_id: Number(editCourseId),
        })
      } else {
        // Create mode
        await createResource({
          title,
          description: description.trim() || undefined,
          url,
          resource_type: resourceType,
          course_id: Number(courseId),
        })

        // Create-only reset: the edit flow must not touch the hash-synced
        // course default (courseId), so "Create resource" still respects the
        // active course context after an edit.
        setCourseId('')
      }

      // Success: confirm to the user, close the form, refresh the resources
      setSuccessMessage(editingId !== null ? 'Changes saved' : 'Resource saved successfully')
      setTitle('')
      setDescription('')
      setUrl('')
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

  // Remove a resource, then refresh. The refetch keeps the current course
  // filter (?course=ID is part of the fetch) untouched.
  async function handleDelete(resource) {
    setDeleteBusyId(resource.id)
    setActionError('')

    try {
      await deleteResource(resource.id)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setActionError(`Couldn’t delete “${resource.title}”: ${err.message}`)
    } finally {
      setDeleteBusyId(null)
    }
  }

  // Required fields must be filled before the resource can be submitted
  const canSave =
    editingId !== null
      ? editTitle.trim() !== '' &&
        editUrl.trim() !== '' &&
        editResourceType !== '' &&
        editCourseId !== ''
      : title.trim() !== '' && url.trim() !== '' && resourceType !== '' && courseId !== ''

  // Search runs AFTER the backend's ?course= filter: `resources` already only
  // holds the current course context, so narrowing it client-side leaves the
  // course filtering untouched. Matches title, description, URL, resource type
  // and the course name/code (all case-insensitive, partial-match). Empty or
  // whitespace query → show everything.
  const q = searchQuery.trim().toLowerCase()
  const filteredResources = q
    ? resources.filter(
        (resource) =>
          (resource.title || '').toLowerCase().includes(q) ||
          (resource.description || '').toLowerCase().includes(q) ||
          (resource.url || '').toLowerCase().includes(q) ||
          (resource.resource_type || '').toLowerCase().includes(q) ||
          (resource.course_name || '').toLowerCase().includes(q) ||
          (resource.course_code || '').toLowerCase().includes(q)
      )
    : resources

  return (
    <div className="resources-page">
      {/* -------- Heading + create button -------- */}
      <div className="section-head">
        <p className="kicker">Resources</p>
        <h2>Study resources</h2>
        <div className="section-head-actions">
          {!loading && !error && resources.length > 0 && (
            <span className="tag">{resources.length} resources</span>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={toggleForm}
          >
            {formOpen ? 'Close form' : 'Create resource'}
          </button>
        </div>
      </div>

      {/* -------- Course-context banner (opened from a course's "View resources") -------- */}
      {/* Gated on ready (!loading) so the course name is always available for the label. */}
      {ready && courseFilterId && (
        <CourseFilterBanner
          itemLabel="Resources"
          course={filterCourse}
          courseId={courseFilterId}
          accent={filterAccent}
          clearHref={clearHref}
          clearText="View all resources"
          clearAriaLabel="Clear course filter — show all resources"
        />
      )}

      {/* -------- Success banner -------- */}
      {successMessage && (
        <p className="form-success" role="status">
          ✓ {successMessage}
        </p>
      )}

      {/* -------- Create resource form -------- */}
      {formOpen && (
        <form className="note-form" onSubmit={handleSave}>
          <h3 className="form-title">
            {editingId !== null ? 'Edit resource' : 'Create resource'}
          </h3>

          <div className="field">
            <label htmlFor="resource-title">Title</label>
            <input
              id="resource-title"
              type="text"
              placeholder="e.g. MIT open courseware — macroeconomics"
              value={editingId !== null ? editTitle : title}
              onChange={(e) =>
                editingId !== null ? setEditTitle(e.target.value) : setTitle(e.target.value)
              }
              required
            />
          </div>

          <div className="field">
            <label htmlFor="resource-url">URL</label>
            <input
              id="resource-url"
              type="url"
              placeholder="https://…"
              value={editingId !== null ? editUrl : url}
              onChange={(e) =>
                editingId !== null ? setEditUrl(e.target.value) : setUrl(e.target.value)
              }
              required
            />
          </div>

          <div className="field">
            <label htmlFor="resource-type">Resource type</label>
            <select
              id="resource-type"
              value={editingId !== null ? editResourceType : resourceType}
              onChange={(e) =>
                editingId !== null
                  ? setEditResourceType(e.target.value)
                  : setResourceType(e.target.value)
              }
              required
            >
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="resource-course">Course</label>
            <select
              id="resource-course"
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

          <div className="field">
            <label htmlFor="resource-description">Description (optional)</label>
            <textarea
              id="resource-description"
              rows="3"
              placeholder="What is this resource for?"
              value={editingId !== null ? editDescription : description}
              onChange={(e) =>
                editingId !== null
                  ? setEditDescription(e.target.value)
                  : setDescription(e.target.value)
              }
            />
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
                  : 'Save resource'}
            </button>
            <button type="button" className="btn-link" onClick={toggleForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* -------- Delete/action error -------- */}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {/* -------- Search (narrows the resources already visible in this course context) -------- */}
      {!loading && !error && resources.length > 0 && (
        <div className="notes-search">
          <label className="notes-search-label" htmlFor="resource-search">
            Search resources
          </label>
          <input
            id="resource-search"
            className="notes-search-input"
            type="search"
            placeholder="Search resources…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* -------- Loading -------- */}
      {loading && (
        <div className="note-grid" role="status" aria-label="Loading resources">
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
            <p className="error-title">Couldn’t load your resources</p>
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
      {!loading && !error && resources.length === 0 && (
        <p className="status-message">
          {courseFilterId
            ? 'No resources for this course yet — tap “Create resource” to add one.'
            : 'No resources yet — tap “Create resource” to add your first one.'}
        </p>
      )}

      {/* -------- Search found nothing (resources exist, but none match) -------- */}
      {!loading && !error && resources.length > 0 && filteredResources.length === 0 && (
        <p className="status-message">
          {courseFilterId ? (
            <>
              No resources in {filterCourse?.name || 'this course'} match “
              {searchQuery.trim()}”.{' '}
              <span className="status-hint">
                Try a different search or clear the course filter.
              </span>
            </>
          ) : (
            <>
              No resources match “{searchQuery.trim()}”.{' '}
              <span className="status-hint">Try a different search.</span>
            </>
          )}
        </p>
      )}

      {/* -------- Resources list (real database data, narrowed by search) -------- */}
      {!loading && !error && filteredResources.length > 0 && (
        <div className="note-grid">
          {filteredResources.map((resource) => {
            const accent = ACCENTS[resource.course_id % ACCENTS.length]
            return (
              <article className="note-card" key={resource.id}>
                <div className="note-card-top">
                  <span className="note-index">
                    {String(resource.id).padStart(2, '0')}
                  </span>
                  <span className="note-date">{formatDate(resource.created_at)}</span>
                </div>
                <h3 className="note-title">{resource.title}</h3>
                {resource.description && (
                  <p className="note-preview">{resource.description}</p>
                )}
                <div className="note-card-foot">
                  <span className="note-type">{resource.resource_type}</span>
                  <span
                    className="course-chip"
                    style={{
                      color: accent.color,
                      backgroundColor: accent.wash,
                      borderColor: accent.line,
                    }}
                  >
                    {resource.course_code}
                  </span>
                  <span className="note-course-name">{resource.course_name}</span>
                  <div className="note-actions">
                    <a
                      className="note-action resource-open"
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${resource.title} in a new tab`}
                    >
                      Open
                      <Icon name="arrow" className="icon--sm" aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      className="note-action"
                      onClick={() => handleEdit(resource)}
                      disabled={deleteBusyId === resource.id}
                    >
                      <Icon name="pencil" className="icon--sm" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="note-action note-action--danger"
                      onClick={() => handleDelete(resource)}
                      disabled={deleteBusyId === resource.id}
                    >
                      <Icon name="trash" className="icon--sm" />
                      {deleteBusyId === resource.id ? 'Deleting…' : 'Delete'}
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

export default ResourcesPage
/* ============================================================
   Small helpers for talking to the Campus AI backend.
   The base URL is environment-driven: VITE_API_URL overrides it
   (e.g. the deployed API origin); the default keeps local dev on
   the Express server at http://localhost:5000.
   ============================================================ */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    // credentials: 'include' sends the httpOnly session cookie set by the
    // backend on signup/login, and accepts its Set-Cookie on responses.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  if (!response.ok) {
    // Backend errors come back as { error: "..." } — pass the message along
    let message = `Request failed with status ${response.status}`
    try {
      const data = await response.json()
      if (data.error) message = data.error
    } catch {
      // Not JSON — keep the generic message
    }
    throw new Error(message)
  }

  return response.json()
}

// GET /api/courses — all courses
export function fetchCourses() {
  return request('/api/courses')
}

// GET /api/notes — the user's own notes, newest first, with course info.
// Pass a courseId to filter to that one course (see the #notes?course=… flow).
export function fetchNotes(courseId) {
  const query = courseId ? `?course=${courseId}` : ''
  return request(`/api/notes${query}`)
}

// POST /api/notes — create a new note
export function createNote({ title, content, course_id }) {
  return request('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title, content, course_id }),
  })
}

// DELETE /api/notes/:id — remove one of the user's notes
export function deleteNote(id) {
  return request(`/api/notes/${id}`, { method: 'DELETE' })
}

// PATCH /api/notes/:id — update the given fields of the user's note
export function updateNote(id, fields) {
  return request(`/api/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

// GET /api/resources — the user's own resources, newest first, with course info.
// Pass a courseId to filter to that one course (see the #resources?course=… flow).
export function getResources(courseId) {
  const query = courseId ? `?course=${courseId}` : ''
  return request(`/api/resources${query}`)
}

// POST /api/resources — create a new resource link
export function createResource({ title, description, url, resource_type, course_id }) {
  return request('/api/resources', {
    method: 'POST',
    body: JSON.stringify({ title, description, url, resource_type, course_id }),
  })
}

// PATCH /api/resources/:id — update the given fields of the user's resource
export function updateResource(id, data) {
  return request(`/api/resources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// DELETE /api/resources/:id — remove one of the user's resources
export function deleteResource(id) {
  return request(`/api/resources/${id}`, { method: 'DELETE' })
}

// GET /api/assignments — the user's own assignments, ordered by due date.
// Pass a courseId to filter to that one course (see the #assignments?course=… flow).
export function fetchAssignments(courseId) {
  const query = courseId ? `?course=${courseId}` : ''
  return request(`/api/assignments${query}`)
}

// POST /api/assignments — create a new assignment
export function createAssignment({
  title,
  description,
  course_id,
  due_date,
  status,
}) {
  return request('/api/assignments', {
    method: 'POST',
    body: JSON.stringify({ title, description, course_id, due_date, status }),
  })
}

// PATCH /api/assignments/:id — update the given fields of an assignment
export function updateAssignment(id, fields) {
  return request(`/api/assignments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

// DELETE /api/assignments/:id — remove an assignment
export function deleteAssignment(id) {
  return request(`/api/assignments/${id}`, { method: 'DELETE' })
}

// GET /api/study-tasks — the user's own study tasks, ordered by study date.
// Pass a courseId to filter to that one course (see the #planner?course=… flow).
export function fetchStudyTasks(courseId) {
  const query = courseId ? `?course=${courseId}` : ''
  return request(`/api/study-tasks${query}`)
}

// POST /api/study-tasks — create a new study task
export function createStudyTask({
  title,
  description,
  course_id,
  study_date,
  priority,
  status,
}) {
  return request('/api/study-tasks', {
    method: 'POST',
    body: JSON.stringify({ title, description, course_id, study_date, priority, status }),
  })
}

// PATCH /api/study-tasks/:id — update the given fields of a study task
export function updateStudyTask(id, fields) {
  return request(`/api/study-tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

// DELETE /api/study-tasks/:id — remove a study task
export function deleteStudyTask(id) {
  return request(`/api/study-tasks/${id}`, { method: 'DELETE' })
}

// POST /api/ai/ask — ask the AI study assistant a question
// Returns { answer } — the backend talks to Gemini (and reports clear errors
// when Gemini is busy or the quota is exhausted).
export function askAI(question) {
  return request('/api/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

// POST /api/ai/plan — generate a study plan for the logged-in user.
// Returns { sessions: [...] }. The route loads the user's own courses and
// assignments server-side and NEVER saves anything — this function only
// generates and returns the proposed sessions for review.
export async function generateStudyPlan(requestText) {
  try {
    return await request('/api/ai/plan', {
      method: 'POST',
      body: JSON.stringify({ request: requestText }),
    })
  } catch (error) {
    // A network-level failure has no HTTP response (and no server message to
    // show), so its raw "Failed to fetch"-style text would be meaningless to
    // a student. Translate it into a safe, human message instead.
    if (
      !error.message ||
      /failed to fetch|network error|load failed/i.test(error.message)
    ) {
      throw new Error('Couldn’t reach the server — please try again in a moment.')
    }
    throw error
  }
}

/* ============================================================
   Auth
   ============================================================ */

// POST /api/auth/signup — create an account and log straight in
export function signup({ name, email, password }) {
  return request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
}

// POST /api/auth/login — sign in with email + password
export function login({ email, password }) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

// POST /api/auth/logout — clear the httpOnly session cookie
export function logout() {
  return request('/api/auth/logout', { method: 'POST' })
}

// GET /api/auth/me — restore a session on app load. A 401 (or any other
// failure) simply means "not logged in", so it resolves to null instead of
// throwing — the AuthProvider turns that into the login screen.
export async function fetchMe() {
  try {
    const data = await request('/api/auth/me')
    return data.user || null
  } catch {
    return null
  }
}
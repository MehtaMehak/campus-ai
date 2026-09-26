import { useEffect, useState } from 'react'
import {
  fetchMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
} from './api.js'
import { AuthContext } from './auth-state.js'

/* ============================================================
   Auth state for the whole app.
   ------------------------------------------------------------
   Holds the signed-in user (or null) and the login / signup /
   logout actions. On mount it asks GET /api/auth/me with the
   httpOnly session cookie, so a refresh keeps you signed in.

   The user object is what the App shell gates on: while
   `loading` is true it shows a splash, and while `user` is null
   it shows the login page instead of the dashboard.
   ============================================================ */

// Module-level one-shot guard for the mount-time session restore. React
// StrictMode (dev) mounts, unmounts and remounts the provider synchronously,
// which used to fire GET /api/auth/me twice per page load and waste
// rate-limit quota. Sharing a single in-flight restore promise means a second
// effect run reuses the same request instead of issuing another. This guard
// is per module instance: a full page refresh re-imports this module, so the
// restore still runs fresh after a reload. Login/logout never call restore,
// so normal auth changes are unaffected.
let restoreInFlight = null

export function AuthProvider({ children }) {
  // Test seam: the jsdom navigation tests inject a fixed user here so the
  // production bundle can render the whole app without a real browser
  // cookie jar. Browsers never set it — it is read once at mount time.
  const bypass =
    typeof window !== 'undefined' && window.__CAMPUS_AUTH_BYPASS__

  const [user, setUser] = useState(bypass || null)
  const [loading, setLoading] = useState(!bypass)

  // Restore a live session from the httpOnly cookie (skip under the test seam).
  useEffect(() => {
    if (bypass) return

    const restore =
      restoreInFlight ||
      (restoreInFlight = fetchMe()
        .then((me) => setUser(me))
        .finally(() => {
          restoreInFlight = null
        }))

    restore.finally(() => setLoading(false))
  }, [bypass])

  async function login({ email, password }) {
    const data = await apiLogin({ email, password })
    setUser(data.user)
    return data.user
  }

  async function signup({ name, email, password }) {
    const data = await apiSignup({ name, email, password })
    setUser(data.user)
    return data.user
  }

  async function logout() {
    try {
      await apiLogout()
    } catch {
      // The session still ends locally even if the network call fails.
    }
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
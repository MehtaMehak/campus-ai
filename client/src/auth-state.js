import { createContext, useContext } from 'react'

/* ============================================================
   Shared auth context + hook.
   ------------------------------------------------------------
   Kept apart from the AuthProvider component so the provider
   file can stay a pure component export (fast refresh works).
   ============================================================ */

export const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}
import { useState } from 'react'
import { useAuth } from './auth-state.js'

/* ============================================================
   Sign in / Sign up
   ------------------------------------------------------------
   A single editorial card with a Sign in ⇄ Sign up toggle.
   On success the auth state flips and the App shell swaps this
   page for the dashboard — nothing else needs to happen here.
   ============================================================ */

export default function LoginPage() {
  const { login, signup } = useAuth()

  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    // Quick client-side checks so empty submissions get instant feedback
    // instead of a round-trip to the backend.
    if (mode === 'signup' && name.trim() === '') {
      setError('Please enter your name.')
      return
    }
    if (email.trim() === '' || password === '') {
      setError('Email and password are required.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'signup') {
        await signup({ name, email, password })
      } else {
        await login({ email, password })
      }
      // Success — the App shell re-renders into the dashboard.
    } catch (err) {
      setError(err.message || 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-card">
        <p className="kicker">Welcome</p>
        <h1 className="auth-title">
          {mode === 'login'
            ? 'Sign in to your desk'
            : 'Create your student account'}
        </h1>
        <p className="auth-lede">
          {mode === 'login'
            ? 'Notes, deadlines and your study plan — all in one place.'
            : 'Pick a name and an email. Your notes and deadlines stay private to you.'}
        </p>

        <div className="auth-toggle" role="tablist" aria-label="Sign in or sign up">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'is-active' : ''}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="auth-name">Name</label>
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@campus.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy
                ? 'One moment…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </div>
        </form>

        <p className="auth-note">
          {mode === 'login'
            ? 'New here? Switch to Sign up — it only takes a few seconds.'
            : 'Already have an account? Switch to Sign in.'}
        </p>
      </div>
    </section>
  )
}
import { useState } from 'react'
import { askAI } from './api.js'
import { Icon } from './Icon.jsx'

/* ============================================================
   AI Assistant
   ------------------------------------------------------------
   A student types a study question and gets an answer from the
   backend, which calls Google Gemini (see server/ai.js). The
   API key stays on the server.
   ============================================================ */

function AIAssistantPage() {
  // Question box + answer flow state
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [askedQuestion, setAskedQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canAsk = question.trim() !== '' && !loading

  // Ask the backend, then show the answer (or an error)
  async function handleAsk(event) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError('')
    setAnswer('')
    setAskedQuestion(trimmed)

    try {
      const data = await askAI(trimmed)
      setAnswer(data.answer)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="assistant-page">
      {/* -------- Heading -------- */}
      <div className="section-head">
        <p className="kicker">AI Assistant</p>
        <h2>Ask your study assistant</h2>
      </div>

      {/* -------- Question form -------- */}
      <form className="assistant-form" onSubmit={handleAsk}>
        <div className="field">
          <label htmlFor="ai-question">Your question</label>
          <textarea
            id="ai-question"
            rows="4"
            placeholder="Ask me anything about your studies..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!canAsk}>
            {loading ? 'Asking…' : 'Ask AI'}
          </button>
        </div>
      </form>

      {/* -------- Error -------- */}
      {error && (
        <div className="error-panel" role="alert">
          <Icon name="alert" className="icon--lg error-icon" />
          <div className="error-copy">
            <p className="error-title">Couldn’t get an answer</p>
            <p className="error-detail">{error}</p>
            <p className="error-hint">
              This is usually temporary — if it keeps happening, make sure the
              backend is running on port 5000.
            </p>
          </div>
        </div>
      )}

      {/* -------- Loading -------- */}
      {loading && (
        <div
          className="assistant-loading"
          role="status"
          aria-label="Getting your answer"
        >
          <div className="skeleton skeleton-line w-80" />
          <div className="skeleton skeleton-line w-95" />
          <div className="skeleton skeleton-line w-70" />
        </div>
      )}

      {/* -------- Empty state (no question asked yet) -------- */}
      {!loading && !error && answer === '' && (
        <div className="assistant-empty">
          <span className="assistant-empty-icon" aria-hidden="true">
            <Icon name="spark" />
          </span>
          <p className="assistant-empty-title">Ready when you are</p>
          <p className="assistant-empty-text">
            Ask about a concept, a chapter, or how to plan your study time.
          </p>
        </div>
      )}

      {/* -------- Answer -------- */}
      {!loading && !error && answer !== '' && (
        <div className="assistant-answer">
          <div className="assistant-answer-head">
            <span className="assistant-answer-label">Answer</span>
            <span className="tag">Gemini</span>
          </div>
          {askedQuestion && (
            <p className="assistant-question">“{askedQuestion}”</p>
          )}
          <p className="assistant-answer-text">{answer}</p>
        </div>
      )}
    </div>
  )
}

export default AIAssistantPage
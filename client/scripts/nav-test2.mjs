/* ============================================================
   Edge-case navigation test (refactored hash-driven navigation)
   ------------------------------------------------------------
   Covers the flows most sensitive to the refactor:
   1. Initial load with a page hash (refresh / deep link)
   2. In-page hash on load (dashboard section)
   3. Quick-add buttons (create-intent + hash navigation)
   4. Header Notes link resets the create intent
   5. Back/forward (hash assignment → hashchange listener)
   ============================================================ */

import { JSDOM } from 'jsdom'
import { pathToFileURL } from 'node:url'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('dist/assets')
const bundle = readdirSync(distDir).find((f) => f.endsWith('.js'))

let failures = 0
function check(name, cond, extra = '') {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}

// Node caches ESM imports — bust it per mount so each case re-executes the
// bundle's top-level createRoot(...).render against its own fresh window.
let run = 0

function mountAppWithHash(hash) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost:5173/${hash}`,
    pretendToBeVisual: true,
  })
  const w = dom.window
  w.scrollTo = () => {}
  w.Element.prototype.scrollIntoView = function () {}
  globalThis.fetch = () => Promise.reject(new TypeError('network down'))
  // Auth test seam — pretend a user is signed in so the full app shell
  // renders without a real browser cookie jar (see AuthContext.jsx).
  w.__CAMPUS_AUTH_BYPASS__ = {
    id: 1,
    name: 'Test User',
    email: 'test@campus.local',
  }
  const setG = (n, v) => {
    try {
      Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true })
    } catch {}
  }
  setG('window', w)
  setG('document', w.document)
  setG('HTMLElement', w.HTMLElement)
  setG('Element', w.Element)
  setG('Node', w.Node)
  setG('MouseEvent', w.MouseEvent)
  setG('Event', w.Event)
  setG('MutationObserver', w.MutationObserver)
  return dom
}

const q = (w, sel) => w.document.querySelector(sel)
const click = (w, el) =>
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }))
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const loadBundle = async () => {
  run++
  return import(pathToFileURL(path.join(distDir, bundle)).href + `?run=${run}`)
}

// ---------------------------------------------------------------
// Case 1: fresh load at #assistant — the AI Assistant page is open
// ---------------------------------------------------------------
console.log('\n--- Case 1: load at #assistant ---')
{
  const dom = mountAppWithHash('#assistant')
  await loadBundle()
  await tick()
  check('initial hash kept', dom.window.location.hash === '#assistant')
  check('assistant page open on load', !!q(dom.window, '.assistant-page'))
  dom.window.close()
}

// ---------------------------------------------------------------
// Case 2: fresh load at #planner
// ---------------------------------------------------------------
console.log('\n--- Case 2: load at #planner ---')
{
  const dom = mountAppWithHash('#planner')
  await loadBundle()
  await tick()
  check('planner page open on load', !!q(dom.window, '.planner-page'))
  dom.window.close()
}

// ---------------------------------------------------------------
// Cases 3–5: dashboard → quick-add → header nav → back/forward
// ---------------------------------------------------------------
console.log('\n--- Cases 3-5: quick-add, intent reset, back/forward ---')
{
  const dom = mountAppWithHash('') // no hash — plain dashboard load
  await loadBundle()
  await tick()
  const w = dom.window

  check('dashboard open on load', !!q(w, '.hero'))

  // 3. Quick-add a note — create form should open (intent + hash)
  const addNote = [...w.document.querySelectorAll('.quick-actions button')].find((b) =>
    b.textContent.includes('Add note')
  )
  check('quick-add "Add note" exists', !!addNote)
  click(w, addNote)
  await tick()
  check('quick-add → hash #notes', w.location.hash === '#notes', `hash="${w.location.hash}"`)
  check('quick-add → notes page open', !!q(w, '.notes-page'))
  check('quick-add → create form open (intent kept)', !!q(w, '.note-form'))

  // 4. Header "Notes" after a quick-add should reset the intent
  //    (navigate away and back via the header)
  const dashboardLink = [...w.document.querySelectorAll('a.nav-link')].find(
    (a) => a.textContent.trim() === 'Dashboard'
  )
  click(w, dashboardLink)
  await tick()
  check('header Dashboard → back on dashboard', w.location.hash === '#dashboard' && !!q(w, '.hero'))

  const notesLink = [...w.document.querySelectorAll('a.nav-link')].find(
    (a) => a.textContent.trim() === 'Notes'
  )
  click(w, notesLink)
  await tick()
  check('header Notes → notes page open', !!q(w, '.notes-page'))
  check('header Notes → create form NOT open (intent reset)', !q(w, '.note-form'))

  // 5. Back/forward: a programmatic hash change (like the back button) works
  w.location.hash = 'assignments'
  await tick()
  check('back/forward-style hash → hash updates', w.location.hash === '#assignments', `hash="${w.location.hash}"`)
  dom.window.close()
}

console.log(failures === 0 ? '\nRESULT: ALL EDGE CASES PASSED' : `\nRESULT: ${failures} EDGE CASE(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
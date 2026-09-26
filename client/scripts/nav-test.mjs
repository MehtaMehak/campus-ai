/* ============================================================
   Navigation interaction test (no real browser needed)
   ------------------------------------------------------------
   Mounts the ACTUAL production bundle in jsdom, then simulates
   clicking "AI Assistant" and "Dashboard" in the header nav and
   asserts that the URL hash changes and the view switches.
   Run: node scripts/nav-test.mjs   (after `npm run build`)
   ============================================================ */

import { JSDOM } from 'jsdom'
import { pathToFileURL } from 'node:url'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const html = `<!doctype html><html><body><div id="root"></div></body></html>`

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/', // fresh load, NO hash — the user's Ctrl+F5 state
  pretendToBeVisual: true,
})

const { window } = dom

// --- Auth test seam -----------------------------------------
// The app now gates on a signed-in user. jsdom has no cookie jar, so we
// pretend a user is already logged in via the AuthProvider's test seam —
// this makes the FULL app shell render (header, nav, pages) exactly as a
// signed-in student would see it. Browsers never set this flag.
window.__CAMPUS_AUTH_BYPASS__ = {
  id: 1,
  name: 'Test User',
  email: 'test@campus.local',
}

// --- Polyfills jsdom lacks (browsers have these natively) ---
window.scrollTo = () => {}
window.Element.prototype.scrollIntoView = function () {}
// Backend is expected to be down during this test — mimic a failed network.
globalThis.fetch = () => Promise.reject(new TypeError('network unavailable (backend down)'))

// Expose the DOM globals the bundle reads at import time.
function setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  } catch {
    /* leave Node's own if it refuses */
  }
}
setGlobal('window', window)
setGlobal('document', window.document)
setGlobal('HTMLElement', window.HTMLElement)
setGlobal('Element', window.Element)
setGlobal('Node', window.Node)
setGlobal('MouseEvent', window.MouseEvent)
setGlobal('Event', window.Event)
setGlobal('MutationObserver', window.MutationObserver)

// Capture React/runtime console errors
const errors = []
const origError = console.error
console.error = (...args) => {
  errors.push(args.map((a) => (a && a.stack ? a.stack : String(a))).join(' '))
}

// --- Load the real built bundle ---
const distDir = path.resolve('dist/assets')
const bundle = readdirSync(distDir).find((f) => f.endsWith('.js'))
if (!bundle) {
  console.error('FAIL  no dist bundle found — run `npm run build` first')
  process.exit(1)
}
console.log(`Loading built bundle: ${bundle}`)

try {
  await import(pathToFileURL(path.join(distDir, bundle)).href)
} catch (err) {
  console.log('FAIL  bundle threw at import time:', err && err.message)
  process.exit(1)
}

// Give React time to mount + run its initial effects (fetches will fail)
await new Promise((r) => setTimeout(r, 300))

const q = (sel) => window.document.querySelector(sel)
let failed = 0
function check(name, cond, extra = '') {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
}

// --- Step 1: the app rendered ---
check('App mounted (#root has content)', q('#root') && q('#root').children.length > 0)
check('Header nav rendered', !!q('nav.nav'))
const links = [...window.document.querySelectorAll('a.nav-link')]
check('Nav links present', links.length >= 7, `count=${links.length}`)
const byText = (t) => links.find((a) => a.textContent.trim() === t)

// --- Step 2: click "AI Assistant" ---
const aiLink = byText('AI Assistant')
check('AI Assistant link exists', !!aiLink)
if (aiLink) {
  aiLink.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })
  )
  await new Promise((r) => setTimeout(r, 200))
  check('AI click → URL hash is #assistant', window.location.hash === '#assistant', `hash="${window.location.hash}"`)
  check('AI click → assistant page rendered', !!q('.assistant-page'))
}

// --- Step 3: click "Dashboard" ---
const dashLink = byText('Dashboard')
check('Dashboard link exists', !!dashLink)
if (dashLink) {
  dashLink.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })
  )
  await new Promise((r) => setTimeout(r, 200))
  check('Dashboard click → URL hash is #dashboard', window.location.hash === '#dashboard', `hash="${window.location.hash}"`)
  check('Dashboard click → dashboard rendered', !!q('.hero'))
}

// --- Step 4: click "Notes" (control group) ---
const notesLink = byText('Notes')
if (notesLink) {
  notesLink.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })
  )
  await new Promise((r) => setTimeout(r, 200))
  check('Notes click → URL hash is #notes', window.location.hash === '#notes', `hash="${window.location.hash}"`)
}

console.log(`\nConsole errors captured: ${errors.length}`)
errors.forEach((e) => console.log(`  ! ${e.slice(0, 400)}`))

console.error = origError
console.log(failed === 0 ? '\nRESULT: ALL CHECKS PASSED' : `\nRESULT: ${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)

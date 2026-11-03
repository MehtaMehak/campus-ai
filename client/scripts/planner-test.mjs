// Run after a fresh frontend build. All requests are mocked; no environment
// files, database, or live Gemini service are used.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const sandbox = {
  module: { exports: {} },
  require(name) {
    if (name === 'dotenv') return { config() {} }
    if (name === '@google/genai') return { GoogleGenAI: class {
      constructor() { throw new Error('Live AI calls are forbidden in regression tests') }
    } }
    throw new Error(`Unexpected dependency: ${name}`)
  },
}
vm.runInNewContext(readFileSync(new URL('../../server/ai.js', import.meta.url), 'utf8'), sandbox)
const { parsePlanSessions } = sandbox.module.exports
const context = { courses: [{ id: 1, code: 'TEST', name: 'Test course' }] }
const session = { title: 'Revise chapter 1', courseId: 1, date: '2026-11-01', priority: 'medium' }
const parse = (sessions) => JSON.parse(JSON.stringify(parsePlanSessions(JSON.stringify({ sessions }), context)))

test('AI priorities normalize to the existing task contract for every casing', () => {
  for (const priority of ['low', 'Low', 'LOW', 'medium', 'Medium', 'mEdIuM', 'high', 'High', 'HIGH']) {
    const expected = priority[0].toUpperCase() + priority.slice(1).toLowerCase()
    assert.equal(parse([{ ...session, priority }])[0].priority, expected)
  }
})

test('invalid or missing AI priorities are rejected rather than defaulted', () => {
  for (const priority of [undefined, null, '', 'urgent', ' medium ', 1, {}, ['low']]) {
    assert.throws(() => parse([{ ...session, priority }]), /invalid priority/)
  }
})

test('malformed AI output is rejected before reaching the review UI', () => {
  for (const text of ['not JSON', 'null', '[]', '{}', '{"sessions":null}', '{"sessions":[]}']) {
    assert.throws(() => parsePlanSessions(text, context), (error) => error.isPlanValidationError === true)
  }
  for (const row of [null, [], { ...session, title: '' }, { ...session, courseId: 99 }, { ...session, date: '2026-02-30' }]) {
    assert.throws(() => parse([row]), (error) => error.isPlanValidationError === true)
  }
  assert.throws(() => parse(Array.from({ length: 21 }, () => session)), /too many/)
  assert.deepEqual(parse([{ ...session, injected: 'discard me' }])[0], { ...session, priority: 'Medium' })
})

test('generated priorities survive actual frontend review and save without manual correction', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost:5173/#planner', pretendToBeVisual: true,
  })
  const { window } = dom
  window.__CAMPUS_AUTH_BYPASS__ = { id: 1, name: 'Fixture user', email: 'fixture@example.invalid' }
  window.scrollTo = () => {}
  window.Element.prototype.scrollIntoView = function () {}
  const previous = new Map()
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true })
  }
  const originalFetch = globalThis.fetch
  const saved = []
  const existing = { id: 50, title: 'Existing task', course_id: 1, course_code: 'TEST', course_name: 'Test course', priority: 'High', status: 'Pending', study_date: '2026-11-01' }
  const generated = parse(['low', 'medium', 'high'].map((priority) => ({ ...session, title: `${priority} session`, priority })))
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname
    let body
    if (path === '/api/courses') body = context.courses
    else if (path === '/api/ai/plan') body = { sessions: generated }
    else if (path === '/api/study-tasks' && options.method === 'POST') {
      const task = JSON.parse(options.body)
      saved.push(task)
      body = { id: 100 + saved.length, ...task }
    } else if (path === '/api/study-tasks') body = [existing]
    else if (['/api/notes', '/api/assignments', '/api/resources'].includes(path)) body = []
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const waitFor = async (predicate, timeout = 3000) => {
    const deadline = Date.now() + timeout
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'Timed out waiting for planner UI')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  try {
    // Read the entry from Vite's generated HTML rather than choosing an
    // arbitrary JavaScript chunk from dist/assets.
    const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
    const entry = html.match(/<script[^>]+src="([^"]+)"/)[1]
    await import(new URL(`../dist/${entry.replace(/^\//, '')}`, import.meta.url).href)
    await waitFor(() => window.document.querySelector('#plan-request') && window.document.querySelector('.planner-title'))
    assert.equal(window.document.querySelector('.priority-pill').textContent, 'High')
    const input = window.document.querySelector('#plan-request')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Plan my revision')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    await waitFor(() => !window.document.querySelector('.ai-plan-form button').disabled)
    window.document.querySelector('.ai-plan-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.document.querySelectorAll('.ai-plan-session').length === 3)
    const selects = [...window.document.querySelectorAll('select[id$="-priority"]')]
    assert.deepEqual(selects.map((select) => select.value), ['Low', 'Medium', 'High'])
    // A student's review edit must still be honored by the save request.
    selects[2].value = 'Low'
    selects[2].dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.document.querySelector('.ai-plan-foot button').click()
    await waitFor(() => window.document.querySelector('.ai-plan-save-success'))
    assert.deepEqual(saved.map((task) => task.priority), ['Low', 'Medium', 'Low'])
    assert.ok(saved.every((task) => task.status === 'Pending' && task.course_id === 1))
    assert.equal(window.document.querySelector('.priority-pill').textContent, 'High')
    // Let the UI's success-message timer finish before disposing its DOM.
    await waitFor(() => !window.document.querySelector('.ai-plan-save-success'), 5000)
  } finally {
    dom.window.close()
    globalThis.fetch = originalFetch
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})

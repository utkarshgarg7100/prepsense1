/**
 * Phase 5 exit criterion: the chooser degrades, it does not break.
 *
 * "Test with the service deliberately stopped — the app must degrade, not break."
 *
 * Every failure mode of a separate process is exercised here against the real
 * `chooseNextQuestion`, not a mock of it: service absent, service returning an error,
 * service returning nonsense, service too slow. In all four the interview must still
 * receive a usable (topic, difficulty).
 *
 * The layer-1 case is skipped rather than failed when nothing is listening on
 * POLICY_URL, so this is runnable without starting Python. Start it to check all of it:
 *
 *     cd ml && .venv/bin/uvicorn serve:app --port 8000
 *     npx tsx scripts/test-chooser.ts
 */

import { createServer, type Server } from 'node:http'
import { DEFAULT_TOPICS } from '../lib/kt/bkt'
import {
  chooseNextQuestion,
  chooseWithThompson,
  difficultyForMastery,
  type ChoiceState,
} from '../lib/ai/chooser'

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const state: ChoiceState = {
  mastery: Object.fromEntries(DEFAULT_TOPICS.map(t => [t, 0.6])),
  attempts: Object.fromEntries(DEFAULT_TOPICS.map(t => [t, 1])),
  recentScores: [72, 65, 80],
  step: 3,
  questions: 12,
}
state.mastery['leadership'] = 0.05

function valid(choice: { topic: string; difficulty: string }): boolean {
  return (
    DEFAULT_TOPICS.includes(choice.topic as (typeof DEFAULT_TOPICS)[number]) &&
    ['easy', 'medium', 'hard'].includes(choice.difficulty)
  )
}

/** A stand-in for the policy service that misbehaves in a specific way. */
function stubServer(handler: (respond: (status: number, body: string) => void) => void) {
  return new Promise<Server>(resolve => {
    const server = createServer((_request, response) => {
      handler((status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(body)
      })
    })
    server.listen(0, () => resolve(server))
  })
}

function portOf(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

async function main() {
  const originalUrl = process.env.POLICY_URL
  const originalTimeout = process.env.POLICY_TIMEOUT_MS

  // --- 1. Service running (skipped if it is not) -----------------------------
  process.env.POLICY_URL = originalUrl ?? 'http://localhost:8000'
  let serviceUp = false
  try {
    const health = await fetch(`${process.env.POLICY_URL}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    serviceUp = health.ok
  } catch {
    serviceUp = false
  }

  if (serviceUp) {
    const choice = await chooseNextQuestion(state)
    check('policy service answers', choice.source === 'policy', `${choice.topic}/${choice.difficulty}`)
    check('policy choice is a real topic', valid(choice))
    check('policy name is recorded', !!choice.policyName, choice.policyName ?? 'missing')
  } else {
    console.log('  skip  policy service not running — start it to exercise layer 1')
  }

  // --- 2. Service stopped: the exit criterion --------------------------------
  // Port 1 is reserved and nothing can bind it, so this is a genuine connection
  // refusal rather than a timeout dressed up as one.
  process.env.POLICY_URL = 'http://127.0.0.1:1'
  const down = await chooseNextQuestion(state)
  check('service down still returns a choice', valid(down), `${down.topic}/${down.difficulty}`)
  check('service down falls back to Thompson', down.source === 'thompson')

  // --- 3. Service up but erroring -------------------------------------------
  const erroring = await stubServer(respond => respond(500, '{"detail":"boom"}'))
  process.env.POLICY_URL = `http://127.0.0.1:${portOf(erroring)}`
  const errored = await chooseNextQuestion(state)
  check('500 falls back rather than throwing', errored.source === 'thompson' && valid(errored))
  erroring.close()

  // --- 4. Service returning a topic that does not exist ----------------------
  // The dangerous case: this would flow onward and tag an answer against a topic the
  // scorecard has no column for, so it must be rejected rather than passed through.
  const nonsense = await stubServer(respond =>
    respond(200, '{"topic":"underwater-basket-weaving","difficulty":"easy","action":0}')
  )
  process.env.POLICY_URL = `http://127.0.0.1:${portOf(nonsense)}`
  const rejected = await chooseNextQuestion(state)
  check('unknown topic is rejected, not passed through', rejected.source === 'thompson' && valid(rejected))
  nonsense.close()

  // --- 5. Service too slow ---------------------------------------------------
  const slow = await stubServer(respond => {
    setTimeout(() => respond(200, '{"topic":"leadership","difficulty":"easy","action":3}'), 3000)
  })
  process.env.POLICY_URL = `http://127.0.0.1:${portOf(slow)}`
  process.env.POLICY_TIMEOUT_MS = '300'
  const started = Date.now()
  const timedOut = await chooseNextQuestion(state)
  const elapsed = Date.now() - started
  check('slow service times out and falls back', timedOut.source === 'thompson' && valid(timedOut))
  check('timeout is actually enforced', elapsed < 1500, `${elapsed}ms`)
  slow.close()
  process.env.POLICY_TIMEOUT_MS = originalTimeout

  // --- 6. The fallback is not a coin flip ------------------------------------
  // Thompson is stochastic, so this asserts a tendency, not a single draw: with
  // leadership at 0.05 against 0.6 everywhere else, it should dominate the sampling.
  const picks = Array.from({ length: 200 }, () => chooseWithThompson(state).topic)
  const leadershipShare = picks.filter(t => t === 'leadership').length / picks.length
  check(
    'Thompson fallback prefers the weak topic',
    leadershipShare > 0.5,
    `leadership ${(leadershipShare * 100).toFixed(0)}% of 200 draws`
  )
  check('Thompson always returns a valid topic', picks.every(t => DEFAULT_TOPICS.includes(t as never)))

  // --- 7. Difficulty tracks ability -----------------------------------------
  check(
    'difficulty rises with mastery',
    difficultyForMastery(0.1) === 'easy' &&
      difficultyForMastery(0.5) === 'medium' &&
      difficultyForMastery(0.9) === 'hard'
  )

  // --- 8. Disabled entirely --------------------------------------------------
  process.env.POLICY_ENABLED = 'false'
  const disabled = await chooseNextQuestion(state)
  check('POLICY_ENABLED=false hands back to the LLM', disabled.source === 'llm')
  delete process.env.POLICY_ENABLED

  process.env.POLICY_URL = originalUrl

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

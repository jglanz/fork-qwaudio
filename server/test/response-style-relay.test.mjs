import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// The style path is read from config at import time, so it is set before the
// provider module loads. node --test runs each file in its own process.
const directory = mkdtempSync(join(tmpdir(), 'qwaudio-response-style-relay-'))
const stylePath = join(directory, 'RESPONSE_STYLE.md')
process.env.QWEN_AUDIO_AGENT_RESPONSE_STYLE_PATH = stylePath
const { REALTIME_PROVIDERS, RealtimeFrontend } = await import('../src/voice/realtime-provider.mjs')

async function relayResult(text) {
  const frontend = new RealtimeFrontend({
    provider: REALTIME_PROVIDERS['speech-to-speech'],
    responseStartTimeoutMs: 50,
    responseCompletionTimeoutMs: 50,
  })
  const sent = []
  frontend.ready = true
  frontend.send = payload => sent.push(payload)

  const outcome = frontend.injectResult(text, 'announcement', { turnId: 'turn-style', taskId: 'job-style' })
  await new Promise(resolve => setImmediate(resolve))
  frontend.handleLifecycle({
    type: 'conversation.item.created',
    item: { ...sent[0].item, status: 'completed' },
  })
  await new Promise(resolve => setImmediate(resolve))
  frontend.handleLifecycle({ type: 'response.created', response: { id: 'resp-style' } })
  frontend.handleLifecycle({ type: 'response.done', response: { id: 'resp-style', status: 'completed' } })
  await outcome
  return sent.find(event => event.type === 'response.create')
}

test('appends the response style file to a relayed backend result', async () => {
  writeFileSync(stylePath, 'Fewest possible words. No greetings.\n')

  const response = await relayResult('Paris.')

  assert.match(response.response.instructions, /结合当前对话自然回应/)
  assert.ok(response.response.instructions.endsWith('\n\nFewest possible words. No greetings.'))
})

test('sends the relay instructions unchanged when the style file is absent', async () => {
  writeFileSync(stylePath, '')

  const response = await relayResult('Paris.')

  assert.match(response.response.instructions, /结合当前对话自然回应/)
  assert.doesNotMatch(response.response.instructions, /Fewest possible words/)
})

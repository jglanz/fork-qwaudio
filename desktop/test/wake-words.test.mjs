import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_WAKE_WORD,
  WAKE_WORDS,
  normalizeWakeWord,
  wakeWordById,
  wakeWordKeywordLine,
  wakeWordLabel,
} from '../src/wake-word/wake-words.mjs'

test('normalizes wake word ids and falls back to the default', () => {
  assert.equal(normalizeWakeWord('qwen'), 'qwen')
  assert.equal(normalizeWakeWord('jarvis'), 'jarvis')
  assert.equal(normalizeWakeWord(' JARVIS '), 'jarvis')
  assert.equal(normalizeWakeWord('unknown'), DEFAULT_WAKE_WORD)
  assert.equal(normalizeWakeWord(''), DEFAULT_WAKE_WORD)
  assert.equal(normalizeWakeWord(null), DEFAULT_WAKE_WORD)
  assert.equal(wakeWordById('nope').id, DEFAULT_WAKE_WORD)
})

test('builds the spotter keyword line with optional overrides', () => {
  assert.equal(
    `${wakeWordKeywordLine(wakeWordById('qwen'))}\n`,
    'n ǐ h ǎo q iān w èn @qwen\n',
  )
  assert.equal(
    wakeWordKeywordLine({ id: 'x', tokens: 'a b', boost: 2, threshold: 0.15 }),
    'a b :2 #0.15 @x',
  )
})

test('labels wake words per language', () => {
  const qwen = wakeWordById('qwen')
  assert.equal(wakeWordLabel(qwen, 'zh-CN'), '你好千问')
  assert.equal(wakeWordLabel(qwen, 'en'), '你好千问 (Hello Qwen)')
  const jarvis = wakeWordById('jarvis')
  assert.equal(wakeWordLabel(jarvis, 'en'), jarvis.phrase)
})

test('wake word ids are unique', () => {
  const ids = WAKE_WORDS.map(word => word.id)
  assert.equal(new Set(ids).size, ids.length)
})

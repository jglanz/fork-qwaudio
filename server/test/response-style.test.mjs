import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadResponseStyle, withResponseStyle } from '../src/voice/response-style.mjs'

const directory = mkdtempSync(join(tmpdir(), 'qwaudio-response-style-'))

test('appends the response style to transient response instructions', () => {
  const response = { modalities: ['audio'], instructions: '  relay the result  ', tool_choice: 'none' }

  const styled = withResponseStyle(response, 'Fewest possible words.')

  assert.deepEqual(styled, {
    modalities: ['audio'],
    instructions: 'relay the result\n\nFewest possible words.',
    tool_choice: 'none',
  })
  assert.equal(response.instructions, '  relay the result  ')
})

test('leaves responses without instructions or without a style unchanged', () => {
  const plain = { modalities: ['audio'] }
  const blank = { instructions: '   ' }
  const relay = { instructions: 'relay the result' }

  assert.equal(withResponseStyle(plain, 'Fewest possible words.'), plain)
  assert.equal(withResponseStyle(blank, 'Fewest possible words.'), blank)
  assert.equal(withResponseStyle(relay, ''), relay)
  assert.equal(withResponseStyle(undefined, 'Fewest possible words.'), undefined)
})

test('loads a trimmed style file and treats a missing file as no style', () => {
  const path = join(directory, 'RESPONSE_STYLE.md')
  writeFileSync(path, '\n  No greetings.\n\n')

  assert.equal(loadResponseStyle(path), 'No greetings.')
  assert.equal(loadResponseStyle(join(directory, 'missing.md')), '')
  assert.equal(loadResponseStyle(''), '')
})

test('caps the style at 2000 characters', () => {
  const path = join(directory, 'long.md')
  writeFileSync(path, 'x'.repeat(2500))

  assert.equal(loadResponseStyle(path).length, 2000)
})

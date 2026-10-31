import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { selectBest } from '../wake-word-tool/lib/evaluate.mjs'
import { keywordLine, keywordsText } from '../wake-word-tool/lib/keywords.mjs'
import {
  englishTokens, parseLexicon, parseTokenSet, validateTokens,
} from '../wake-word-tool/lib/lexicon.mjs'
import { pinyinToTokens } from '../wake-word-tool/lib/pinyin.mjs'
import { buildEntry, readEntries, registerEntry, upsertEntry } from '../wake-word-tool/lib/registry.mjs'
import { planClips } from '../wake-word-tool/lib/synth.mjs'
import { wakeWordKeywordLine } from '../desktop/src/wake-word/wake-words.mjs'

test('pinyin converts to initials and tone-marked finals', () => {
  assert.equal(pinyinToTokens('ni3 hao3 qian1 wen4'), 'n ǐ h ǎo q iān w èn')
  assert.equal(pinyinToTokens('nv3'), 'n ǚ')
  assert.equal(pinyinToTokens('nü3'), 'n ǚ')
  assert.equal(pinyinToTokens('er2'), 'ér')
  assert.equal(pinyinToTokens('lve4'), 'l üè')
  assert.equal(pinyinToTokens('zhou1 jun1'), 'zh ōu j ūn')
  assert.equal(pinyinToTokens('you3'), 'y ǒu')
  assert.equal(pinyinToTokens('liu2 dui4 suo3'), 'l iú d uì s uǒ')
})

test('pinyin neutral tone has no mark', () => {
  assert.equal(pinyinToTokens('ma5'), 'm a')
  assert.equal(pinyinToTokens('de'), 'd e')
})

test('pinyin rejects invalid input', () => {
  assert.throws(() => pinyinToTokens(''), /empty/)
  assert.throws(() => pinyinToTokens('n1'), /no final/)
  assert.throws(() => pinyinToTokens('ni9'), /invalid/)
})

const LEXICON = parseLexicon([
  'HEY HH EY1', 'JARVIS JH AA1 R V AH0 S', "DON'T D OW1 N T", 'HELLO HH AH0 L OW1',
].join('\n'))

test('lexicon tokenizes phrases and reports out-of-vocabulary words', () => {
  assert.equal(englishTokens('Hey, Jarvis!', LEXICON), 'HH EY1 JH AA1 R V AH0 S')
  assert.equal(englishTokens("don't hello", LEXICON), "D OW1 N T HH AH0 L OW1")
  assert.throws(() => englishTokens('Hey Zorblax Quux', LEXICON), /ZORBLAX, QUUX.*--tokens/)
})

test('tokens are validated against tokens.txt', () => {
  const set = parseTokenSet('<blk> 0\nHH 1\nEY1 2\nǐ 3\n')
  assert.equal(validateTokens('HH  EY1', set), 'HH EY1')
  assert.throws(() => validateTokens('HH XX', set), /token "XX"/)
  assert.throws(() => validateTokens('  ', set), /empty/)
})

test('keyword lines carry optional boost and threshold and a shared id', () => {
  assert.equal(keywordLine({ tokens: 'A B', id: 'x' }), 'A B @x')
  assert.equal(keywordLine({ tokens: 'A B', boost: 2, threshold: 0.15, id: 'x' }), 'A B :2 #0.15 @x')
  assert.equal(keywordsText('x', ['A B', 'A C'], { boost: 1.5 }), 'A B :1.5 @x\nA C :1.5 @x\n')
  assert.throws(() => keywordLine({ tokens: 'A', id: 'a b' }), /spaces/)
  const entry = { id: 'jarvis', tokens: 'HH EY1', boost: 2, threshold: 0.15 }
  assert.equal(keywordLine(entry), wakeWordKeywordLine(entry))
})

const cell = (boost, threshold, recall, falseTriggers) => ({
  boost, threshold, recall, falseTriggers, positives: 6, negatives: 11, results: [],
})

test('grid selection prefers recall, then highest threshold, then lowest boost', () => {
  const cells = [
    cell(3, 0.1, 6, 1), cell(2, 0.15, 5, 0), cell(2.5, 0.2, 5, 0), cell(1.5, 0.2, 5, 0), cell(3, 0.25, 4, 0),
  ]
  assert.deepEqual(
    (({ boost, threshold }) => ({ boost, threshold }))(selectBest(cells)),
    { boost: 1.5, threshold: 0.2 },
  )
})

test('grid selection returns null without a clean cell unless false triggers are allowed', () => {
  const cells = [cell(2, 0.2, 6, 2), cell(1, 0.25, 3, 1), cell(1.5, 0.25, 5, 1)]
  assert.equal(selectBest(cells), null)
  const best = selectBest(cells, { allowFalseTriggers: true })
  assert.deepEqual([best.boost, best.threshold], [1.5, 0.25])
})

const REGISTRY = `// header comment
export const A = 1

// wake-word-tool:begin
export const WAKE_WORDS = Object.freeze([
  {
    "id": "qwen",
    "phrase": "你好千问",
    "translation": "Hello Qwen",
    "tokens": "n ǐ h ǎo q iān w èn"
  }
].map(word => Object.freeze(word)))
// wake-word-tool:end

export function other() { return 'untouched' }
`

test('registry add keeps everything outside the JSON block byte-for-byte', () => {
  const entry = buildEntry({
    id: 'jarvis', phrase: 'Hey Jarvis', tokens: 'HH EY1', boost: 2, threshold: 0.15,
  })
  const { source, action } = upsertEntry(REGISTRY, entry)
  assert.equal(action, 'added')
  const start = REGISTRY.indexOf('[')
  const end = REGISTRY.lastIndexOf(']') + 1
  assert.equal(source.slice(0, start), REGISTRY.slice(0, start))
  assert.equal(source.slice(source.lastIndexOf(']') + 1), REGISTRY.slice(end))
  assert.deepEqual(readEntries(source).map(word => word.id), ['qwen', 'jarvis'])
  assert.deepEqual(readEntries(source)[1], entry)
})

test('registry update replaces by id, omits defaults and keeps the translation', () => {
  const first = upsertEntry(REGISTRY, buildEntry({
    id: 'qwen', phrase: '你好千问', tokens: 'n ǐ', boost: 1, threshold: 0.25,
  }))
  assert.equal(first.action, 'updated')
  assert.deepEqual(readEntries(first.source), [
    { id: 'qwen', phrase: '你好千问', translation: 'Hello Qwen', tokens: 'n ǐ' },
  ])
  const second = upsertEntry(first.source, buildEntry({
    id: 'qwen', phrase: '你好千问', tokens: 'n ǐ', boost: '2', threshold: '0.2',
  }))
  assert.deepEqual(readEntries(second.source)[0].boost, 2)
  assert.equal(readEntries(second.source).length, 1)
})

test('buildEntry rejects entries the app cannot use', () => {
  const valid = { id: 'hey-computer', phrase: 'Hey Computer', tokens: 'HH EY1' }
  assert.equal(buildEntry(valid).id, 'hey-computer')
  for (const id of ['HeyComputer', 'hey computer', '', '-lead', null]) {
    assert.throws(() => buildEntry({ ...valid, id }), /invalid id/)
  }
  for (const phrase of [null, '', '   ']) {
    assert.throws(() => buildEntry({ ...valid, phrase }), /--phrase/)
  }
  for (const boost of ['abc', 0, -1, Infinity]) {
    assert.throws(() => buildEntry({ ...valid, boost }), /invalid boost/)
  }
  for (const threshold of ['abc', 0, 1, 1.5]) {
    assert.throws(() => buildEntry({ ...valid, threshold }), /invalid threshold/)
  }
  assert.deepEqual(buildEntry({ ...valid, boost: '3', threshold: '0.2' }), { ...valid, boost: 3, threshold: 0.2 })
})

test('registerEntry writes a fixture file and rejects files without markers', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'wake-word-tool-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = resolve(directory, 'wake-words.mjs')
  writeFileSync(path, REGISTRY)
  registerEntry(path, buildEntry({ id: 'jarvis', phrase: 'Hey Jarvis', tokens: 'HH EY1' }))
  assert.equal(readEntries(readFileSync(path, 'utf8')).length, 2)
  assert.throws(() => upsertEntry('export const x = 1\n', buildEntry({ id: 'a', phrase: 'a', tokens: 'A' })), /markers/)
})

test('clip plan covers positives, user and default negatives and other wake words', () => {
  const clips = planClips({
    phrase: 'Hey Jarvis', language: 'english', speakers: ['Aiden', 'Ryan'], takes: 2,
    negatives: ['Hey Gervais'], otherPhrases: ['你好千问', 'hey jarvis'],
  })
  const texts = kind => new Set(clips.filter(clip => clip.kind === kind).map(clip => clip.text))
  assert.ok(texts('positive').has('Hey Jarvis'))
  assert.equal(texts('positive').size, 3)
  assert.ok(texts('negative').has('Hey Gervais'))
  assert.ok(texts('negative').has('你好千问'))
  assert.ok(!texts('negative').has('hey jarvis'))
  assert.equal(clips.filter(clip => clip.text === 'Hey Jarvis').length, 4)
  assert.equal(new Set(clips.map(clip => clip.file)).size, clips.length)
})

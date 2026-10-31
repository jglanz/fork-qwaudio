#!/usr/bin/env node
// Adds and validates wake words for the desktop keyword spotter. See README.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_BOOSTS, DEFAULT_THRESHOLDS, buildReport, evaluateGrid, loadManifest, renderReport, selectBest,
} from './lib/evaluate.mjs'
import { englishTokens, parseLexicon, parseTokenSet, validateTokens } from './lib/lexicon.mjs'
import { LEXICON_FILE, defaultCacheDir, ensureModel, readModelFile } from './lib/model.mjs'
import { pinyinToTokens } from './lib/pinyin.mjs'
import { assertWakeWordId, buildEntry, readEntries, registerEntry } from './lib/registry.mjs'
import { detectLanguage, DEFAULT_SPEAKERS, isChinese, synthesize } from './lib/synth.mjs'
import { WAKE_WORD_MODEL_FILES } from '../desktop/src/wake-word/model-manager.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REGISTRY = resolve(ROOT, 'desktop/src/wake-word/wake-words.mjs')

const COMMON = { 'cache-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } }
const PRONUNCIATION = {
  phrase: { type: 'string' },
  pinyin: { type: 'string' },
  tokens: { type: 'string', multiple: true },
}
const SYNTH = {
  language: { type: 'string' },
  speakers: { type: 'string' },
  takes: { type: 'string' },
  negative: { type: 'string', multiple: true },
  python: { type: 'string' },
  engine: { type: 'string' },
  gpu: { type: 'boolean' },
}
const GRID = {
  boosts: { type: 'string' },
  thresholds: { type: 'string' },
  'allow-false-triggers': { type: 'boolean' },
}
const REGISTER = {
  translation: { type: 'string' },
  boost: { type: 'string' },
  threshold: { type: 'string' },
  registry: { type: 'string' },
}

const COMMANDS = {
  tokens: {
    options: { ...PRONUNCIATION, id: { type: 'string' } },
    usage: `wake-word-tool tokens --phrase "Hey Jarvis"
wake-word-tool tokens --phrase 你好千问 --pinyin "ni3 hao3 qian1 wen4"
wake-word-tool tokens --id jarvis --tokens "HH EY1 JH AA1 R V IH0 S" [--tokens "..."]

Prints the keyword line(s). English words come from en.phone; Mandarin needs
--pinyin (numbered, v or ü for ü, tone 5/none = neutral). --tokens replaces the
derived pronunciation and may repeat for variants. Every token is checked
against tokens.txt. --id appends @id to each line.`,
  },
  synth: {
    options: { ...PRONUNCIATION, ...SYNTH, out: { type: 'string' } },
    usage: `wake-word-tool synth --phrase "Hey Jarvis" --out DIR [--language english|chinese]
  [--speakers Aiden,Ryan] [--takes 2] [--negative "Hey Harvey"]... [--python PY] [--engine qwen3|espeak] [--gpu]

Writes positive clips (phrase alone and in carrier sentences) and negative clips
(--negative, a default near-miss list, other registered wake words) plus
manifest.json into DIR. Qwen3-TTS needs --python (or WAKE_WORD_TOOL_PYTHON) with
faster_qwen3_tts installed and runs on CPU unless --gpu; without it espeak-ng is
used and recall numbers are unrepresentative.`,
  },
  evaluate: {
    options: { ...PRONUNCIATION, ...GRID, id: { type: 'string' }, clips: { type: 'string' }, out: { type: 'string' } },
    usage: `wake-word-tool evaluate --id ID (--tokens "..." | --phrase ...) --clips DIR
  [--boosts 1,1.5,2,2.5,3] [--thresholds 0.25,0.2,0.15,0.1] [--out RUN_DIR] [--allow-false-triggers]

Runs every boost/threshold cell over DIR/manifest.json with the desktop spotter
settings and picks the highest recall with zero false triggers (ties: highest
threshold, then lowest boost). Writes report.json and report.md to the run
directory. Exits non-zero when no cell is free of false triggers.`,
  },
  register: {
    options: { ...PRONUNCIATION, ...REGISTER, id: { type: 'string' }, 'from-report': { type: 'string' } },
    usage: `wake-word-tool register --id ID --phrase "..." --tokens "..." [--translation "..."]
  [--boost B] [--threshold T] [--registry PATH]
wake-word-tool register --from-report report.json [--registry PATH]

Adds or updates one entry in the registry (default desktop/src/wake-word/wake-words.mjs),
rewriting only the JSON between the wake-word-tool markers. Default boost/threshold
are omitted. The registry holds one tokens sequence per word.`,
  },
  run: {
    options: {
      ...PRONUNCIATION, ...SYNTH, ...GRID, ...REGISTER, id: { type: 'string' }, out: { type: 'string' },
      register: { type: 'boolean' },
    },
    usage: `wake-word-tool run --id ID --phrase "..." [--pinyin "..."] [--tokens "..."]
  [synth options] [evaluate options] [--register] [--out RUN_DIR]

tokens -> synth -> evaluate -> summary. --register also writes the registry.
Default run directory: <cache-dir>/runs/<id>-<timestamp>.`,
  },
}

const list = (text, fallback) => (text ? text.split(',').map(item => Number(item.trim())) : fallback)

function need(value, flag) {
  if (value == null || value === '') throw new Error(`missing ${flag}`)
  return value
}

async function model(values) {
  const cacheDir = resolve(values['cache-dir'] ?? defaultCacheDir())
  const dir = await ensureModel(cacheDir, message => console.error(message))
  return { cacheDir, dir }
}

// Derives the token variants for a phrase, or returns the explicit --tokens.
async function resolveTokens(values) {
  const { cacheDir, dir } = await model(values)
  const tokenSet = parseTokenSet(readModelFile(dir, WAKE_WORD_MODEL_FILES.tokens))
  let variants = values.tokens ?? []
  if (!variants.length) {
    const phrase = need(values.phrase, '--phrase or --tokens')
    if (values.pinyin) variants = [pinyinToTokens(values.pinyin)]
    else if (isChinese(phrase)) throw new Error('Chinese phrases need --pinyin "ni3 hao3 ..." (numbered pinyin)')
    else variants = [englishTokens(phrase, parseLexicon(readModelFile(dir, LEXICON_FILE)))]
  }
  return { cacheDir, dir, variants: variants.map(tokens => validateTokens(tokens, tokenSet)) }
}

function otherPhrases(id, registry) {
  try {
    return readEntries(readFileSync(registry, 'utf8')).filter(word => word.id !== id).map(word => word.phrase)
  } catch {
    return []
  }
}

function runSynth(values, phrase, directory, id) {
  const language = values.language ?? detectLanguage(phrase)
  if (!DEFAULT_SPEAKERS[language]) throw new Error(`unsupported language "${language}"`)
  return synthesize({
    phrase, language, directory,
    speakers: values.speakers ? values.speakers.split(',').map(item => item.trim()) : DEFAULT_SPEAKERS[language],
    takes: Number(values.takes ?? 2),
    negatives: values.negative ?? [],
    otherPhrases: otherPhrases(id, resolve(values.registry ?? DEFAULT_REGISTRY)),
    python: values.python ?? process.env.WAKE_WORD_TOOL_PYTHON ?? null,
    engine: values.engine ?? null,
    gpu: values.gpu ?? false,
    warn: message => console.error(message),
  })
}

function runEvaluate(values, { id, phrase, variants, modelDir, clipsDir, runDir }) {
  const clips = loadManifest(clipsDir)
  const allow = values['allow-false-triggers'] ?? false
  const cells = evaluateGrid({
    modelDir, id, variants, clips, directory: clipsDir,
    boosts: list(values.boosts, DEFAULT_BOOSTS),
    thresholds: list(values.thresholds, DEFAULT_THRESHOLDS),
    onCell: cell => console.error(`boost ${cell.boost} threshold ${cell.threshold}: recall ${cell.recall}/${cell.positives}, false triggers ${cell.falseTriggers}/${cell.negatives}`),
  })
  const chosen = selectBest(cells, { allowFalseTriggers: allow })
  const report = buildReport({ id, phrase, variants, directory: clipsDir, cells, chosen, allowFalseTriggers: allow })
  mkdirSync(runDir, { recursive: true })
  writeFileSync(resolve(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(resolve(runDir, 'report.md'), renderReport(report))
  console.log(renderReport(report).split('\n## Clips')[0])
  console.log(`report: ${resolve(runDir, 'report.md')}`)
  if (!chosen) process.exitCode = 1
  return report
}

function register(values, { id, phrase, variants, boost, threshold }) {
  if (variants.length !== 1) throw new Error('the registry holds one tokens sequence per word; pass a single --tokens')
  const entry = buildEntry({
    id, phrase, translation: values.translation ?? null, tokens: variants[0], boost, threshold,
  })
  const registry = resolve(values.registry ?? DEFAULT_REGISTRY)
  const action = registerEntry(registry, entry)
  console.log(`${action} "${id}" in ${registry}`)
  console.log('Restart the desktop app to pick up the new wake word (it loads the registry at startup).')
}

const runDirFor = (values, cacheDir, id) =>
  resolve(values.out ?? resolve(cacheDir, 'runs', `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`))

const HANDLERS = {
  async tokens(values) {
    const { variants } = await resolveTokens(values)
    for (const tokens of variants) console.log(values.id ? `${tokens} @${values.id}` : tokens)
  },
  async synth(values) {
    const phrase = need(values.phrase, '--phrase')
    const manifest = runSynth(values, phrase, resolve(need(values.out, '--out')), values.id ?? '')
    console.log(`wrote ${manifest.clips.length} clips to ${resolve(values.out)}`)
  },
  async evaluate(values) {
    const id = assertWakeWordId(need(values.id, '--id'))
    const { cacheDir, dir, variants } = await resolveTokens(values)
    runEvaluate(values, {
      id, phrase: values.phrase ?? null, variants, modelDir: dir,
      clipsDir: resolve(need(values.clips, '--clips')), runDir: runDirFor(values, cacheDir, id),
    })
  },
  async register(values) {
    if (values['from-report']) {
      const report = JSON.parse(readFileSync(resolve(values['from-report']), 'utf8'))
      if (!report.chosen) throw new Error('the report has no chosen boost/threshold')
      register(values, {
        id: report.id, phrase: values.phrase ?? report.phrase, variants: report.tokens,
        boost: report.chosen.boost, threshold: report.chosen.threshold,
      })
      return
    }
    const id = assertWakeWordId(need(values.id, '--id'))
    const phrase = need(values.phrase, '--phrase')
    const { variants } = await resolveTokens(values)
    register(values, {
      id, phrase, variants, boost: values.boost ?? null, threshold: values.threshold ?? null,
    })
  },
  async run(values) {
    const id = assertWakeWordId(need(values.id, '--id'))
    const phrase = need(values.phrase, '--phrase')
    const { cacheDir, dir, variants } = await resolveTokens(values)
    const runDir = runDirFor(values, cacheDir, id)
    for (const tokens of variants) console.log(`tokens: ${tokens}`)
    const clipsDir = resolve(runDir, 'clips')
    runSynth(values, phrase, clipsDir, id)
    const report = runEvaluate(values, { id, phrase, variants, modelDir: dir, clipsDir, runDir })
    if (values.register && report.chosen?.recall > 0) {
      register(values, {
        id, phrase, variants, boost: report.chosen.boost, threshold: report.chosen.threshold,
      })
    } else if (values.register) {
      console.error('not registering: no grid cell detects the phrase without false triggers')
    }
  },
}

const GENERAL_USAGE = `wake-word-tool <command> [options]

Commands: ${Object.keys(COMMANDS).join(', ')}
Run "wake-word-tool <command> --help" for details. See wake-word-tool/README.md.`

async function main(argv) {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h') {
    console.log(GENERAL_USAGE)
    return
  }
  const command = COMMANDS[name]
  if (!command) throw new Error(`unknown command "${name}"\n${GENERAL_USAGE}`)
  const { values } = parseArgs({ args: rest, options: { ...COMMON, ...command.options }, strict: true })
  if (values.help) {
    console.log(command.usage)
    return
  }
  await HANDLERS[name](values)
}

main(process.argv.slice(2)).catch(error => {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
})

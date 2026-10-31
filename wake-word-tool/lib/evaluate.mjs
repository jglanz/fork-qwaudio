import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createKeywordSpotter } from '../../desktop/src/wake-word/sherpa-detector.mjs'
import { keywordsText } from './keywords.mjs'
import { readWav } from './wav.mjs'

export const DEFAULT_BOOSTS = [1, 1.5, 2, 2.5, 3]
export const DEFAULT_THRESHOLDS = [0.25, 0.2, 0.15, 0.1]

export function loadManifest(directory) {
  const parsed = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'))
  const clips = Array.isArray(parsed) ? parsed : parsed.clips
  for (const clip of clips) {
    if (clip.kind !== 'positive' && clip.kind !== 'negative') {
      throw new Error(`manifest clip ${clip.file}: kind must be positive or negative`)
    }
  }
  return clips
}

// Mirrors the live microphone path: 100 ms chunks, decode while ready, reset
// after a hit, then one second of silence so a trailing keyword can fire.
function detectHits(spotter, { sampleRate, samples }) {
  const stream = spotter.createStream()
  let hits = 0
  const chunk = Math.round(sampleRate / 10)
  const feed = data => {
    for (let start = 0; start < data.length; start += chunk) {
      stream.acceptWaveform(sampleRate, data.subarray(start, start + chunk))
      while (spotter.isReady(stream)) {
        spotter.decode(stream)
        if (spotter.getResult(stream).keyword) {
          hits += 1
          spotter.reset(stream)
        }
      }
    }
  }
  feed(samples)
  feed(new Float32Array(sampleRate))
  stream.free?.()
  return hits
}

export function evaluateGrid({ modelDir, id, variants, clips, directory, boosts, thresholds, onCell = () => {} }) {
  const audio = clips.map(clip => readWav(resolve(directory, clip.file)))
  const positives = clips.filter(clip => clip.kind === 'positive').length
  const cells = []
  for (const threshold of thresholds) {
    for (const boost of boosts) {
      const spotter = createKeywordSpotter(modelDir, keywordsText(id, variants, { boost, threshold }))
      const results = clips.map((clip, index) => ({
        file: clip.file, text: clip.text, kind: clip.kind, speaker: clip.speaker ?? null,
        hits: detectHits(spotter, audio[index]),
      }))
      spotter.free?.()
      const cell = {
        boost, threshold, positives,
        recall: results.filter(item => item.kind === 'positive' && item.hits > 0).length,
        falseTriggers: results.filter(item => item.kind === 'negative' && item.hits > 0).length,
        negatives: clips.length - positives,
        results,
      }
      cells.push(cell)
      onCell(cell)
    }
  }
  return cells
}

// Highest recall among cells with zero false triggers; ties go to the highest
// threshold, then the lowest boost. Returns null when no cell is clean, unless
// allowFalseTriggers, which then minimises false triggers first.
export function selectBest(cells, { allowFalseTriggers = false } = {}) {
  const clean = cells.filter(cell => cell.falseTriggers === 0)
  const pool = clean.length || !allowFalseTriggers ? clean : cells
  if (!pool.length) return null
  return [...pool].sort((a, b) =>
    a.falseTriggers - b.falseTriggers
    || b.recall - a.recall
    || b.threshold - a.threshold
    || a.boost - b.boost)[0]
}

export function buildReport({ id, phrase, variants, directory, cells, chosen, allowFalseTriggers }) {
  const view = chosen ?? selectBest(cells, { allowFalseTriggers: true })
  return {
    id, phrase, tokens: variants, clips: directory,
    chosen: chosen ? { boost: chosen.boost, threshold: chosen.threshold, recall: chosen.recall, positives: chosen.positives, falseTriggers: chosen.falseTriggers, negatives: chosen.negatives } : null,
    allowFalseTriggers,
    grid: cells.map(({ results: _results, ...cell }) => cell),
    results: view ? view.results : [],
    resultsFor: view ? { boost: view.boost, threshold: view.threshold } : null,
  }
}

export function renderReport(report) {
  const lines = [
    `# Wake word report: ${report.id}`, '',
    `- phrase: ${report.phrase ?? '(not given)'}`,
    ...report.tokens.map(tokens => `- tokens: \`${tokens}\``),
    `- clips: ${report.clips}`, '',
    '## Grid', '',
    '| boost | threshold | recall | false triggers |', '|---|---|---|---|',
    ...report.grid.map(cell => `| ${cell.boost} | ${cell.threshold} | ${cell.recall}/${cell.positives} | ${cell.falseTriggers}/${cell.negatives} |`),
    '', '## Chosen', '',
    report.chosen
      ? `boost ${report.chosen.boost}, threshold ${report.chosen.threshold}: recall ${report.chosen.recall}/${report.chosen.positives}, false triggers ${report.chosen.falseTriggers}/${report.chosen.negatives}`
      : 'No grid cell has zero false triggers.',
    '',
  ]
  if (report.resultsFor) {
    lines.push(`## Clips (boost ${report.resultsFor.boost}, threshold ${report.resultsFor.threshold})`, '',
      '| clip | kind | text | hits |', '|---|---|---|---|',
      ...report.results.map(item => `| ${item.file} | ${item.kind} | ${item.text ?? ''} | ${item.hits} |`), '')
  }
  return `${lines.join('\n')}`
}

import { readFileSync, writeFileSync } from 'node:fs'
import {
  DEFAULT_KEYWORD_BOOST,
  DEFAULT_KEYWORD_THRESHOLD,
} from '../../desktop/src/wake-word/wake-words.mjs'
const BEGIN = '// wake-word-tool:begin'
const END = '// wake-word-tool:end'

// Splits the registry source into [before JSON][JSON array][after JSON]; only
// the middle part is ever rewritten.
function splitRegistry(source) {
  const begin = source.indexOf(BEGIN)
  const end = source.indexOf(END)
  if (begin < 0 || end < begin) throw new Error(`registry is missing the ${BEGIN} / ${END} markers`)
  const freeze = source.indexOf('Object.freeze(', begin)
  const start = freeze < 0 ? -1 : source.indexOf('[', freeze)
  const close = source.lastIndexOf(']', end)
  if (start < 0 || close < start) throw new Error('registry has no JSON array between the markers')
  return {
    before: source.slice(0, start),
    json: source.slice(start, close + 1),
    after: source.slice(close + 1),
  }
}

export function readEntries(source) {
  return JSON.parse(splitRegistry(source).json)
}

// The app lowercases ids before matching them and writes `@id` into the keyword
// line, so an id is lowercase letters, digits, '-' and '_' only.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export function assertWakeWordId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`invalid id "${id}": use lowercase letters, digits, "-" and "_" (for example hey-computer)`)
  }
  return id
}

function positiveSetting(value, name, { below = Infinity } = {}) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number >= below) {
    const range = below === Infinity ? 'a number above 0' : `a number between 0 and ${below}`
    throw new Error(`invalid ${name} "${value}": must be ${range}`)
  }
  return number
}

export function buildEntry({ id, phrase, translation = null, tokens, boost = null, threshold = null }) {
  assertWakeWordId(id)
  if (typeof phrase !== 'string' || !phrase.trim()) {
    throw new Error('a wake word needs a non-empty --phrase (it is the Settings dropdown label)')
  }
  if (typeof tokens !== 'string' || !tokens.trim()) throw new Error('a wake word needs tokens')
  const boostValue = positiveSetting(boost, 'boost')
  const thresholdValue = positiveSetting(threshold, 'threshold', { below: 1 })
  return {
    id,
    phrase: phrase.trim(),
    ...(translation ? { translation } : {}),
    tokens: tokens.trim(),
    ...(boostValue == null || boostValue === DEFAULT_KEYWORD_BOOST ? {} : { boost: boostValue }),
    ...(thresholdValue == null || thresholdValue === DEFAULT_KEYWORD_THRESHOLD
      ? {}
      : { threshold: thresholdValue }),
  }
}

// Adds or replaces the entry with the same id; returns { source, action }.
export function upsertEntry(source, entry) {
  const parts = splitRegistry(source)
  const entries = JSON.parse(parts.json)
  const index = entries.findIndex(item => item.id === entry.id)
  let action = 'added'
  if (index >= 0) {
    action = 'updated'
    const previous = entries[index]
    entries[index] = !entry.translation && previous.translation
      ? { ...entry, translation: previous.translation }
      : entry
    // Keep key order stable: translation sits after phrase.
    entries[index] = buildEntry(entries[index])
  } else {
    entries.push(entry)
  }
  return {
    action,
    source: `${parts.before}${JSON.stringify(entries, null, 2)}${parts.after}`,
  }
}

export function registerEntry(path, entry) {
  const result = upsertEntry(readFileSync(path, 'utf8'), entry)
  writeFileSync(path, result.source)
  return result.action
}

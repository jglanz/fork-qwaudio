// Wake words the desktop detector can listen for; Settings offers them in a
// dropdown and the detector loads only the selected one. Browser-safe: the
// Settings renderer imports this module directly.
//
// `tokens` spells the phrase in the zh-en keyword model's units: pinyin
// initials and tone-marked finals for Mandarin, ARPAbet phones for English.
// `boost` and `threshold` are per-keyword overrides of the spotter defaults
// below; omit them to use the defaults.
//
// Entries between the markers below are maintained by wake-word-tool
// (`npm run wake-word -- register`), which tunes and validates them; see
// wake-word-tool/README.md. Keep the list valid JSON.

export const DEFAULT_WAKE_WORD = 'qwen'
export const DEFAULT_KEYWORD_BOOST = 1
export const DEFAULT_KEYWORD_THRESHOLD = 0.25

// wake-word-tool:begin
export const WAKE_WORDS = Object.freeze([
  {
    "id": "qwen",
    "phrase": "你好千问",
    "translation": "Hello Qwen",
    "tokens": "n ǐ h ǎo q iān w èn"
  },
  {
    "id": "jarvis",
    "phrase": "Hey Jarvis",
    "tokens": "HH EY1 JH AA1 R V AH0 S",
    "boost": 3,
    "threshold": 0.2
  }
].map(word => Object.freeze(word)))
// wake-word-tool:end

export function normalizeWakeWord(id) {
  const value = String(id || '').trim().toLowerCase()
  return WAKE_WORDS.some(word => word.id === value) ? value : DEFAULT_WAKE_WORD
}

export function wakeWordById(id) {
  const value = normalizeWakeWord(id)
  return WAKE_WORDS.find(word => word.id === value)
}

// One line of the spotter's keywords file: `tokens [:boost] [#threshold] @id`.
export function wakeWordKeywordLine(word) {
  return [
    word.tokens,
    ...(word.boost === undefined ? [] : [`:${word.boost}`]),
    ...(word.threshold === undefined ? [] : [`#${word.threshold}`]),
    `@${word.id}`,
  ].join(' ')
}

// Dropdown text: the phrase as it must be spoken, plus a translation for
// English UI when the phrase is not English.
export function wakeWordLabel(word, language = 'zh-CN') {
  return language === 'en' && word.translation
    ? `${word.phrase} (${word.translation})`
    : word.phrase
}

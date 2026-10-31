// Numbered pinyin ("ni3 hao3") -> the keyword model's tokens (initial, then a
// tone-marked final: "n ǐ h ǎo").
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
  'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w']
// Combining marks keyed by tone; "ü" has precomposed forms.
const MARKS = { 1: '\u0304', 2: '\u0301', 3: '\u030c', 4: '\u0300' }
const VOWELS = 'aeiouü'

function markIndex(final) {
  const a = final.search(/[ae]/)
  if (a >= 0) return a
  const o = final.indexOf('ou')
  if (o >= 0) return o
  for (let index = final.length - 1; index >= 0; index -= 1) {
    if (VOWELS.includes(final[index])) return index
  }
  return -1
}

function applyTone(final, tone) {
  if (!MARKS[tone]) return final
  const index = markIndex(final)
  if (index < 0) throw new Error(`no vowel to carry tone ${tone} in "${final}"`)
  return (final.slice(0, index + 1) + MARKS[tone] + final.slice(index + 1)).normalize('NFC')
}

// One syllable such as "qian1", "nv3", "er2", "de" (no tone digit = neutral).
function syllableToTokens(syllable) {
  const match = /^([a-zü:]+?)([1-5])?$/i.exec(String(syllable).trim())
  if (!match) throw new Error(`invalid pinyin syllable "${syllable}"`)
  let body = match[1].toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü')
  const tone = match[2] ? Number(match[2]) : 5
  const initial = INITIALS.find(candidate => body.startsWith(candidate)) ?? ''
  let final = body.slice(initial.length)
  if (!final) throw new Error(`pinyin syllable "${syllable}" has no final`)
  // The model spells ü as plain u after j/q/x/y (j ūn, y uán); only n/l keep ü.
  if ('jqxy'.includes(initial) && initial) final = final.replace(/^ü/, 'u')
  return [...(initial ? [initial] : []), applyTone(final, tone)]
}

export function pinyinToTokens(pinyin) {
  const syllables = String(pinyin).trim().split(/[\s,]+/).filter(Boolean)
  if (!syllables.length) throw new Error('pinyin is empty')
  return syllables.flatMap(syllableToTokens).join(' ')
}

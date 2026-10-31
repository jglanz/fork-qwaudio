// English phrase -> ARPAbet phones via the CMU-style en.phone lexicon
// (`WORD PH1 PH2 ...` per line), plus validation against tokens.txt.
export function parseLexicon(text) {
  const lexicon = new Map()
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [word, ...phones] = parts
    if (!lexicon.has(word)) lexicon.set(word, phones.join(' '))
  }
  return lexicon
}

function phraseWords(phrase) {
  return phrase
    .toUpperCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function englishTokens(phrase, lexicon) {
  const words = phraseWords(phrase)
  if (!words.length) throw new Error('phrase has no words')
  const missing = words.filter(word => !lexicon.has(word))
  if (missing.length) {
    throw new Error(
      `out-of-vocabulary words: ${missing.join(', ')}. Pass the pronunciation with --tokens "PH1 PH2 ...".`,
    )
  }
  return words.map(word => lexicon.get(word)).join(' ')
}

export function parseTokenSet(tokensText) {
  return new Set(tokensText.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean))
}

export function validateTokens(tokens, tokenSet) {
  const list = tokens.trim().split(/\s+/).filter(Boolean)
  if (!list.length) throw new Error('tokens are empty')
  for (const token of list) {
    if (!tokenSet.has(token)) throw new Error(`token "${token}" is not in tokens.txt`)
  }
  return list.join(' ')
}

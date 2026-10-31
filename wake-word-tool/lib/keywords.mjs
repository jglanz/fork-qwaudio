// One spotter keywords line: `tokens [:boost] [#threshold] @id`.
export function keywordLine({ tokens, boost = null, threshold = null, id }) {
  if (/\s/.test(id)) throw new Error(`wake word id "${id}" must not contain spaces`)
  return [
    tokens,
    ...(boost == null ? [] : [`:${boost}`]),
    ...(threshold == null ? [] : [`#${threshold}`]),
    `@${id}`,
  ].join(' ')
}

// All pronunciation variants share the id so any of them fires the same word.
export function keywordsText(id, variants, { boost = null, threshold = null } = {}) {
  return `${variants.map(tokens => keywordLine({ tokens, boost, threshold, id })).join('\n')}\n`
}

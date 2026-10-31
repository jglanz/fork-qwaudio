import { readFileSync } from 'node:fs'
import { config } from '../core/config.mjs'

const MAX_STYLE_CHARS = 2000

// Optional user file whose text is appended to every transient response
// instruction: result relays, progress updates, permission and input requests,
// reminders and direct speech. Providers such as speech-to-speech replace the
// session prompt with those instructions, so without this the assistant profile
// and user preferences never reach the words spoken for backend results.
// Read on every use, so edits apply to the next response.
export function loadResponseStyle(path = config.responseStylePath) {
  if (!path) return ''
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
  return [...content.trim()].slice(0, MAX_STYLE_CHARS).join('')
}

export function withResponseStyle(response, style = loadResponseStyle()) {
  const instructions = typeof response?.instructions === 'string'
    ? response.instructions.trim()
    : ''
  if (!instructions || !style) return response
  return { ...response, instructions: `${instructions}\n\n${style}` }
}

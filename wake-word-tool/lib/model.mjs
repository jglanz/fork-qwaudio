import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  WAKE_WORD_MODEL_FILES, WAKE_WORD_MODEL_NAME, WAKE_WORD_MODEL_SHA256, WAKE_WORD_MODEL_URL,
} from '../../desktop/src/wake-word/model-manager.mjs'

export const LEXICON_FILE = 'en.phone'
const REQUIRED = [
  WAKE_WORD_MODEL_FILES.encoder, WAKE_WORD_MODEL_FILES.decoder, WAKE_WORD_MODEL_FILES.joiner,
  WAKE_WORD_MODEL_FILES.tokens, LEXICON_FILE,
]

export function defaultCacheDir() {
  const base = process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache')
  return resolve(base, 'qwen-audio-agent', 'wake-word-tool')
}

const complete = directory => REQUIRED.every(file => existsSync(resolve(directory, file)))

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

// Prefers the packages the desktop model manager uses; falls back to system tar.
async function extract(archive, directory) {
  let tarStream = null
  let unbzip2 = null
  try {
    tarStream = (await import('tar-stream')).default
    unbzip2 = (await import('unbzip2-stream')).default
  } catch {
    const result = spawnSync('tar', ['-xjf', archive, '-C', directory, '--strip-components=1'], {
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`tar extraction failed: ${result.stderr || result.error}`)
    return
  }
  const root = resolve(directory)
  const extractor = tarStream.extract()
  const writes = []
  extractor.on('entry', (header, stream, next) => {
    const relative = header.name.split('/').slice(1).join('/')
    const destination = resolve(root, relative)
    if (header.type !== 'file' || !relative || !destination.startsWith(root + sep)) {
      stream.resume()
      stream.on('end', next)
      return
    }
    mkdirSync(dirname(destination), { recursive: true })
    writes.push(pipeline(stream, createWriteStream(destination)).then(next, error => extractor.destroy(error)))
  })
  await pipeline(createReadStream(archive), unbzip2(), extractor)
  await Promise.all(writes)
}

// Downloads, verifies and extracts the keyword spotter archive (including the
// en.phone lexicon the desktop install drops) into the cache; returns its directory.
export async function ensureModel(cacheDir, log = () => {}) {
  const target = resolve(cacheDir, 'models', WAKE_WORD_MODEL_NAME)
  if (complete(target)) return target
  mkdirSync(dirname(target), { recursive: true })
  const nonce = `${process.pid}-${Date.now()}`
  const archive = resolve(dirname(target), `${WAKE_WORD_MODEL_NAME}-${nonce}.tar.bz2`)
  const staging = resolve(dirname(target), `.${WAKE_WORD_MODEL_NAME}-${nonce}`)
  mkdirSync(staging)
  try {
    log(`downloading ${WAKE_WORD_MODEL_URL}`)
    const response = await fetch(WAKE_WORD_MODEL_URL)
    if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    if (await sha256(archive) !== WAKE_WORD_MODEL_SHA256) throw new Error('model archive sha256 mismatch')
    await extract(archive, staging)
    if (!complete(staging)) throw new Error('model archive is missing required files')
    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
    return target
  } finally {
    rmSync(archive, { force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}

export function readModelFile(modelDir, name) {
  return readFileSync(resolve(modelDir, name), 'utf8')
}

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { ensureWakeWordModel, WAKE_WORD_MODEL_FILES } from './model-manager.mjs'
import {
  DEFAULT_KEYWORD_BOOST,
  DEFAULT_KEYWORD_THRESHOLD,
  normalizeWakeWord,
  wakeWordById,
  wakeWordKeywordLine,
} from './wake-words.mjs'

const require = createRequire(import.meta.url)
const engines = new Map()

function pcm16Base64ToFloat32(audio) {
  const bytes = Buffer.from(audio, 'base64')
  const sampleCount = Math.floor(bytes.length / 2)
  const samples = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32768
  }
  return samples
}

// The single definition of the keyword spotter settings. wake-word-tool
// evaluates candidate keywords with this same function, so its results match
// what the desktop detector runs.
export function createKeywordSpotter(modelDirectory, keywords) {
  const { createKws } = require('sherpa-onnx')
  return createKws({
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: resolve(modelDirectory, WAKE_WORD_MODEL_FILES.encoder),
        decoder: resolve(modelDirectory, WAKE_WORD_MODEL_FILES.decoder),
        joiner: resolve(modelDirectory, WAKE_WORD_MODEL_FILES.joiner),
      },
      tokens: resolve(modelDirectory, WAKE_WORD_MODEL_FILES.tokens),
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelingUnit: 'cjkchar',
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: DEFAULT_KEYWORD_BOOST,
    keywordsThreshold: DEFAULT_KEYWORD_THRESHOLD,
    // WASM cannot pass a host path through the native keywords_file field, so
    // the keywords are supplied as a buffer, independent of the WASM virtual
    // filesystem.
    keywords: '',
    keywordsBuf: keywords,
    keywordsBufSize: Buffer.byteLength(keywords),
  })
}

async function createEngine({ modelRoot, wakeWord }) {
  const modelDirectory = await ensureWakeWordModel(modelRoot)
  const keywords = `${wakeWordKeywordLine(wakeWordById(wakeWord))}\n`
  return createKeywordSpotter(modelDirectory, keywords)
}

async function engineFor({ modelRoot, wakeWord }) {
  const id = normalizeWakeWord(wakeWord)
  const key = `${resolve(modelRoot)}\0${id}`
  if (!engines.has(key)) {
    engines.set(key, createEngine({ modelRoot, wakeWord: id }).catch(error => {
      engines.delete(key)
      throw error
    }))
  }
  return engines.get(key)
}

export async function createSherpaWakeWordDetector({ modelRoot, wakeWord }) {
  const keywordSpotter = await engineFor({ modelRoot, wakeWord })
  const stream = keywordSpotter.createStream()
  return {
    accept(audio, sampleRate = 16000) {
      const samples = pcm16Base64ToFloat32(audio)
      if (!samples.length) return false
      stream.acceptWaveform(sampleRate, samples)
      // The spotter reports a keyword only at the decode step where it fires,
      // so check after every step; a chunk can span several steps.
      let detected = false
      while (keywordSpotter.isReady(stream)) {
        keywordSpotter.decode(stream)
        if (keywordSpotter.getResult(stream).keyword) {
          keywordSpotter.reset(stream)
          detected = true
        }
      }
      return detected
    },
    reset() {
      keywordSpotter.reset(stream)
    },
  }
}

export { pcm16Base64ToFloat32 }

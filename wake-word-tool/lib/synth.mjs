import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELPER = resolve(dirname(fileURLToPath(import.meta.url)), 'qwen3_say.py')

export const DEFAULT_SPEAKERS = {
  english: ['Aiden', 'Ryan'],
  chinese: ['Vivian', 'Serena'],
}

const CARRIERS = {
  english: ['Hey, {p}, what is the weather like today?', 'Okay {p}, please turn on the lights.'],
  chinese: ['{p}，今天天气怎么样？', '请问{p}，现在几点了？'],
}

// Near-miss and general speech that must not wake the app.
const DEFAULT_NEGATIVES = {
  english: [
    'Hey Harvey', 'Hey Travis', 'Hey Service', 'Hello there', 'Hey Java', 'Okay Google',
    'What is the weather like today?', 'Please play some music.', 'Set a timer for ten minutes.',
    'Hey, how are you doing?',
  ],
  chinese: [
    '你好', '你好吗', '千问', '你好，今天怎么样？', '今天天气很好', '请打开灯', '你们好', '好的，谢谢',
  ],
}

export const isChinese = text => /[一-鿿]/.test(text)
export const detectLanguage = phrase => (isChinese(phrase) ? 'chinese' : 'english')

const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)

// Builds the clip list; `otherPhrases` (other registered wake words) become negatives.
export function planClips({
  phrase, language, speakers, takes = 1, negatives = [], otherPhrases = [],
}) {
  const same = text => text.trim().toLowerCase() === phrase.trim().toLowerCase()
  const positives = [phrase, ...CARRIERS[language].map(carrier => carrier.replace('{p}', phrase))]
  const negativeTexts = [...new Set([
    ...negatives, ...DEFAULT_NEGATIVES[language], ...otherPhrases,
  ].filter(text => !same(text)))]
  const clips = []
  for (const [kind, texts] of [['positive', positives], ['negative', negativeTexts]]) {
    texts.forEach((text, index) => {
      for (const speaker of speakers) {
        for (let take = 1; take <= takes; take += 1) {
          clips.push({
            file: `${kind === 'positive' ? 'pos' : 'neg'}-${String(index + 1).padStart(2, '0')}-${slug(text)}-${speaker}-t${take}.wav`,
            text, kind, speaker, language,
          })
        }
      }
    })
  }
  return clips
}

function runEspeak(clips, directory) {
  for (const clip of clips) {
    const voice = clip.language === 'chinese' ? 'cmn' : 'en-us'
    const result = spawnSync('espeak-ng', ['-v', voice, '-w', resolve(directory, clip.file), clip.text], {
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`espeak-ng failed for "${clip.text}": ${result.stderr || result.error}`)
  }
}

function runQwen3(clips, directory, python, { gpu }) {
  const jobsPath = resolve(directory, 'jobs.json')
  writeFileSync(jobsPath, JSON.stringify(clips.map(clip => ({
    text: clip.text, speaker: clip.speaker, language: clip.language, out: resolve(directory, clip.file),
  })), null, 2))
  const env = { ...process.env, ...(gpu ? {} : { CUDA_VISIBLE_DEVICES: '' }) }
  const result = spawnSync(python, ['-I', HELPER, jobsPath], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  if (result.status !== 0) throw new Error(`Qwen3-TTS helper failed (${python}, exit ${result.status})`)
}

// Writes the clips and manifest.json into `directory`; returns the manifest.
export function synthesize({
  phrase, language, speakers, takes, negatives, otherPhrases, directory, python = null,
  engine = null, gpu = false, warn = console.warn,
}) {
  const chosenEngine = engine ?? (python ? 'qwen3' : 'espeak')
  if (chosenEngine === 'qwen3' && !python) {
    throw new Error('the qwen3 engine needs --python (or WAKE_WORD_TOOL_PYTHON) pointing at a Python with faster_qwen3_tts')
  }
  let clips = planClips({
    phrase, language, speakers: chosenEngine === 'espeak' ? ['espeak'] : speakers,
    takes: chosenEngine === 'espeak' ? 1 : takes, negatives, otherPhrases,
  })
  if (chosenEngine === 'espeak') {
    warn('warning: espeak-ng clips are too robotic for this model; recall numbers will be unrepresentative. Use --python with faster_qwen3_tts for real validation.')
  }
  mkdirSync(directory, { recursive: true })
  if (chosenEngine === 'espeak') runEspeak(clips, directory)
  else runQwen3(clips, directory, python, { gpu })
  clips = clips.map(clip => ({ ...clip, engine: chosenEngine }))
  const manifest = { phrase, language, clips }
  writeFileSync(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

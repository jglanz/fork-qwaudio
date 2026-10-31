import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { DesktopWakeWordRuntime } from '../src/wake-word/runtime.mjs'

class FakeWorker extends EventEmitter {
  static instances = []

  constructor(url, options) {
    super()
    this.url = url
    this.options = options
    this.messages = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }

  postMessage(message) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }
}

test('desktop owns wake-word detection and forwards only hidden audio to its worker', () => {
  let detections = 0
  const runtime = new DesktopWakeWordRuntime({
    modelRoot: '/tmp/wake-word',
    onDetected: () => { detections += 1 },
    WorkerClass: FakeWorker,
  })

  assert.equal(runtime.accept('before-ready'), false)
  runtime.setEnabled(true)
  const worker = FakeWorker.instances.at(-1)
  assert.equal(worker.options.workerData.modelRoot, '/tmp/wake-word')
  assert.equal(runtime.accept('before-ready'), false)

  worker.emit('message', { type: 'ready' })
  assert.equal(runtime.accept('pcm', 16_000), true)
  assert.deepEqual(worker.messages, [{
    type: 'audio',
    audio: 'pcm',
    sampleRate: 16_000,
  }])

  worker.emit('message', { type: 'detected' })
  assert.equal(detections, 1)
  runtime.setEnabled(false)
  assert.equal(worker.terminated, true)
  assert.equal(runtime.accept('after-stop'), false)
})

test('worker data carries the selected wake word and defaults unknown ids', () => {
  const runtime = new DesktopWakeWordRuntime({
    modelRoot: '/tmp/wake-word',
    wakeWord: 'jarvis',
    WorkerClass: FakeWorker,
  })
  runtime.setEnabled(true)
  assert.equal(FakeWorker.instances.at(-1).options.workerData.wakeWord, 'jarvis')
  const fallback = new DesktopWakeWordRuntime({
    modelRoot: '/tmp/wake-word',
    wakeWord: 'unknown',
    WorkerClass: FakeWorker,
  })
  fallback.setEnabled(true)
  assert.equal(FakeWorker.instances.at(-1).options.workerData.wakeWord, 'qwen')
})

test('setWakeWord restarts the worker only on change and only when enabled', () => {
  const runtime = new DesktopWakeWordRuntime({
    modelRoot: '/tmp/wake-word',
    WorkerClass: FakeWorker,
  })
  const before = FakeWorker.instances.length
  runtime.setWakeWord('jarvis')
  assert.equal(FakeWorker.instances.length, before)

  runtime.setEnabled(true)
  const first = FakeWorker.instances.at(-1)
  assert.equal(first.options.workerData.wakeWord, 'jarvis')
  runtime.setWakeWord('JARVIS')
  assert.equal(first.terminated, false)
  assert.equal(FakeWorker.instances.length, before + 1)

  runtime.setWakeWord('qwen')
  const second = FakeWorker.instances.at(-1)
  assert.equal(first.terminated, true)
  assert.notEqual(second, first)
  assert.equal(second.options.workerData.wakeWord, 'qwen')
})

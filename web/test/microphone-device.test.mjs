import assert from 'node:assert/strict'
import test from 'node:test'

import {
  microphoneAudioConstraints,
  resolveAudioInputDeviceId,
} from '../src/realtime/microphone-device.js'

const devices = [
  { kind: 'audioinput', label: 'Built-in Mic', deviceId: 'a1' },
  { kind: 'audioinput', label: 'USB Mic', deviceId: 'b2' },
  { kind: 'audiooutput', label: 'Speakers', deviceId: 'c3' },
]

test('resolves a device id by exact audioinput label', () => {
  assert.equal(resolveAudioInputDeviceId(devices, 'USB Mic'), 'b2')
})

test('returns null for no match, empty label, or non-audioinput devices', () => {
  assert.equal(resolveAudioInputDeviceId(devices, 'Unplugged Mic'), null)
  assert.equal(resolveAudioInputDeviceId(devices, ''), null)
  assert.equal(resolveAudioInputDeviceId(devices, 'Speakers'), null)
  assert.equal(resolveAudioInputDeviceId(null, 'USB Mic'), null)
})

test('adds an exact deviceId constraint only when a device is selected', () => {
  const flags = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  assert.deepEqual(microphoneAudioConstraints(), flags)
  assert.deepEqual(microphoneAudioConstraints(null), flags)
  assert.deepEqual(microphoneAudioConstraints('b2'), { ...flags, deviceId: { exact: 'b2' } })
})

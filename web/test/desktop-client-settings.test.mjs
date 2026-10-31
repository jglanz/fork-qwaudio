import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyDesktopClientSettings,
  initialDesktopClientSettings,
} from '../src/desktop/desktop-client-settings.js'

test('desktop client settings initialize from the desktop URL', () => {
  assert.deepEqual(initialDesktopClientSettings(
    '?orbSkin=firefly&autoHideSeconds=300&wakeWordEnabled=true&lang=en',
  ), {
    orbSkinId: 'firefly',
    autoHideSeconds: 300,
    wakeWordEnabled: true,
    language: 'en',
    audioInput: '',
  })
  assert.equal(
    initialDesktopClientSettings('?audioInput=USB+Mic').audioInput,
    'USB Mic',
  )
})

test('desktop client settings hot-apply without replacing unrelated state', () => {
  const current = {
    orbSkinId: 'fluid',
    autoHideSeconds: 60,
    wakeWordEnabled: false,
    language: 'zh-CN',
    audioInput: 'USB Mic',
  }

  assert.deepEqual(applyDesktopClientSettings(current, {
    orbSkin: 'firefly',
    autoHideSeconds: 120,
    language: 'en',
  }), {
    orbSkinId: 'firefly',
    autoHideSeconds: 120,
    wakeWordEnabled: false,
    language: 'en',
    audioInput: 'USB Mic',
  })
  assert.equal(applyDesktopClientSettings(current, { audioInput: '' }).audioInput, '')
  assert.equal(applyDesktopClientSettings(current, { audioInput: 3 }).audioInput, 'USB Mic')
})

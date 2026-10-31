import { resolveOrbSkinId } from '../../../shared/orb-skin-catalog.mjs'
import {
  desktopAudioInput,
  desktopAutoHideSeconds,
  desktopWakeWordEnabled,
} from './desktop-hide.js'

export function initialDesktopClientSettings(search = '') {
  const params = new URLSearchParams(search)
  return {
    orbSkinId: resolveOrbSkinId({
      orbSkin: params.get('orbSkin'),
      orbStyle: params.get('orbStyle'),
    }),
    autoHideSeconds: desktopAutoHideSeconds(search),
    wakeWordEnabled: desktopWakeWordEnabled(search),
    language: params.get('lang') || '',
    audioInput: desktopAudioInput(search),
  }
}

export function applyDesktopClientSettings(current, update = {}) {
  return {
    orbSkinId: update.orbSkin
      ? resolveOrbSkinId({ orbSkin: update.orbSkin })
      : current.orbSkinId,
    autoHideSeconds: Number.isFinite(update.autoHideSeconds)
      ? update.autoHideSeconds
      : current.autoHideSeconds,
    wakeWordEnabled: typeof update.wakeWordEnabled === 'boolean'
      ? update.wakeWordEnabled
      : current.wakeWordEnabled,
    language: update.language || current.language,
    audioInput: typeof update.audioInput === 'string'
      ? update.audioInput
      : current.audioInput,
  }
}

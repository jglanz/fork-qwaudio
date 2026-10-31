// 设备标签是跨页面稳定的标识；deviceId 按页面来源哈希，不能跨窗口复用。
export function resolveAudioInputDeviceId(devices, label) {
  const wanted = typeof label === 'string' ? label.trim() : ''
  if (!wanted || !Array.isArray(devices)) return null
  const match = devices.find(device => (
    device?.kind === 'audioinput'
    && device.label === wanted
    && device.deviceId
  ))
  return match ? match.deviceId : null
}

export function microphoneAudioConstraints(deviceId = null) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  return audio
}

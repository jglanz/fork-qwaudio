import { readFileSync } from 'node:fs'

// Mono Float32 samples from a RIFF WAV (PCM16 or float32; first channel only).
export function readWav(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path}: not a RIFF WAV`)
  let offset = 12
  let format = { code: 1, channels: 1, sampleRate: 16000, bits: 16 }
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = {
        code: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      const bytes = format.bits / 8
      const frame = bytes * format.channels
      const end = Math.min(body + size, buffer.length)
      const count = Math.floor((end - body) / frame)
      const samples = new Float32Array(count)
      for (let index = 0; index < count; index += 1) {
        const at = body + index * frame
        if (format.code === 3 && format.bits === 32) samples[index] = buffer.readFloatLE(at)
        else if (format.bits === 16) samples[index] = buffer.readInt16LE(at) / 32768
        else throw new Error(`${path}: unsupported WAV format (code ${format.code}, ${format.bits} bits)`)
      }
      return { sampleRate: format.sampleRate, samples }
    }
    offset = body + size + (size % 2)
  }
  throw new Error(`${path}: no data chunk`)
}

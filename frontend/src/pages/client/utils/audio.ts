/**
 * Audio processing utilities for the client voice system.
 */

/** Encode an ArrayBuffer to a Base64 string (binary-safe). */
export function encodeToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const parts: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(parts.join(''))
}

/** Resample a Float32Array from `nativeSr` to 16 kHz using OfflineAudioContext. */
export async function resampleTo16k(float32: Float32Array<ArrayBuffer>, nativeSr: number): Promise<Float32Array> {
  const targetLen = Math.ceil(float32.length * 16000 / nativeSr)
  const offline = new OfflineAudioContext(1, targetLen, 16000)
  const buf = offline.createBuffer(1, float32.length, nativeSr)
  buf.copyToChannel(float32, 0)
  const src = offline.createBufferSource()
  src.buffer = buf
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

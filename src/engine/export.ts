import { GIFEncoder, quantize, applyPalette } from 'gifenc'

function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

export async function exportPng(img: ImageData, scale = 1): Promise<Blob> {
  const base = imageDataToCanvas(img)
  let canvas: HTMLCanvasElement = base
  if (scale !== 1) {
    canvas = document.createElement('canvas')
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
  }
  return await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
}

/**
 * Share a generated image via the Web Share API, falling back to a download when
 * sharing isn't supported. User-initiated only, and it shares the *rendered result*
 * — never the source photo — so it stays consistent with the on-device promise.
 */
export async function shareImage(blob: Blob, filename: string, text?: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean
    share?: (data?: ShareData) => Promise<void>
  }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'FaceStudio', text })
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
    return
  }
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Encode frames to an animated GIF (fully client-side, no server). */
export async function exportGif(
  frames: ImageData[],
  fps: number,
  onProgress?: (frac: number) => void,
): Promise<Blob> {
  const enc = GIFEncoder()
  const delay = Math.round(1000 / fps)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const palette = quantize(f.data, 256)
    const index = applyPalette(f.data, palette)
    enc.writeFrame(index, f.width, f.height, { palette, delay })
    onProgress?.((i + 1) / frames.length)
    await new Promise((r) => setTimeout(r, 0)) // let the progress bar paint
  }
  enc.finish()
  return new Blob([enc.bytes()], { type: 'image/gif' })
}

function pickVideoMime(): string {
  const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c
  return 'video/webm'
}

/** Encode frames to WebM (or MP4 on Safari) via a canvas capture stream. */
export async function exportVideo(
  frames: ImageData[],
  fps: number,
  onProgress?: (frac: number) => void,
): Promise<Blob> {
  const w = frames[0].width
  const h = frames[0].height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const mime = pickVideoMime()
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: mime }))
  })
  rec.start()
  const frameMs = 1000 / fps
  for (let i = 0; i < frames.length; i++) {
    ctx.putImageData(frames[i], 0, 0)
    track.requestFrame()
    onProgress?.((i + 1) / frames.length)
    await new Promise((r) => setTimeout(r, frameMs))
  }
  rec.stop()
  return done
}


export interface ZipEntry {
  name: string
  blob: Blob
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}

/**
 * Create a standards-compliant, uncompressed ZIP archive in-browser.
 * Keeping this encoder local avoids a third-party service or paid dependency.
 * Intended for ordinary portrait batches; ZIP64 (>4 GB archives) is not supported.
 */
export async function exportZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) throw new Error('There are no edited photos to package.')

  const encoder = new TextEncoder()
  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = new Uint8Array(await entry.blob.arrayBuffer())
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    write32(localView, 0, 0x04034b50)
    write16(localView, 4, 20)
    write16(localView, 6, 0x0800) // UTF-8 filenames
    write16(localView, 8, 0) // stored, no compression
    write16(localView, 10, 0)
    write16(localView, 12, 0)
    write32(localView, 14, crc)
    write32(localView, 18, data.length)
    write32(localView, 22, data.length)
    write16(localView, 26, name.length)
    write16(localView, 28, 0)
    local.set(name, 30)
    localParts.push(local, data)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    write32(centralView, 0, 0x02014b50)
    write16(centralView, 4, 20)
    write16(centralView, 6, 20)
    write16(centralView, 8, 0x0800)
    write16(centralView, 10, 0)
    write16(centralView, 12, 0)
    write16(centralView, 14, 0)
    write32(centralView, 16, crc)
    write32(centralView, 20, data.length)
    write32(centralView, 24, data.length)
    write16(centralView, 28, name.length)
    write16(centralView, 30, 0)
    write16(centralView, 32, 0)
    write16(centralView, 34, 0)
    write16(centralView, 36, 0)
    write32(centralView, 38, 0)
    write32(centralView, 42, localOffset)
    central.set(name, 46)
    centralParts.push(central)

    localOffset += local.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + (part as Uint8Array).byteLength, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  write32(endView, 0, 0x06054b50)
  write16(endView, 4, 0)
  write16(endView, 6, 0)
  write16(endView, 8, entries.length)
  write16(endView, 10, entries.length)
  write32(endView, 12, centralSize)
  write32(endView, 16, localOffset)
  write16(endView, 20, 0)

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
}

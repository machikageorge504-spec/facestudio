import { describe, expect, it } from 'vitest'
import { exportZip } from '../export'

describe('exportZip', () => {
  it('packages multiple files into a ZIP archive with valid record signatures', async () => {
    const archive = await exportZip([
      { name: 'portrait-one.png', blob: new Blob(['first image bytes'], { type: 'image/png' }) },
      { name: 'portrait-two.png', blob: new Blob(['second image bytes'], { type: 'image/png' }) },
    ])
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const view = new DataView(bytes.buffer)

    expect(archive.type).toBe('application/zip')
    expect(view.getUint32(0, true)).toBe(0x04034b50) // first local file header

    let centralHeaders = 0
    let endRecord = -1
    for (let i = 0; i <= bytes.length - 4; i++) {
      const signature = view.getUint32(i, true)
      if (signature === 0x02014b50) centralHeaders++
      if (signature === 0x06054b50) endRecord = i
    }

    expect(centralHeaders).toBe(2)
    expect(endRecord).toBeGreaterThan(0)
    expect(view.getUint16(endRecord + 8, true)).toBe(2)
    expect(new TextDecoder().decode(bytes)).toContain('portrait-one.png')
    expect(new TextDecoder().decode(bytes)).toContain('portrait-two.png')
  })

  it('rejects an empty batch instead of creating an unusable archive', async () => {
    await expect(exportZip([])).rejects.toThrow('There are no edited photos to package.')
  })
})

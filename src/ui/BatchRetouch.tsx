import { useState } from 'react'
import { useStore } from '../state/store'
import { getParsing } from '../engine/parsing'
import { computeEdit } from '../engine/edit'
import { DEFAULT_EDIT_SETTINGS } from '../engine/types'
import { downloadBlob, exportPng, exportZip, type ZipEntry } from '../engine/export'

/**
 * Retouches loaded portraits locally, then packages successful results into one ZIP.
 * Android browsers choose the download location; the app cannot silently write to Gallery.
 */
export function BatchRetouch() {
  const faces = useStore((s) => s.faces)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [done, setDone] = useState(0)
  const [shareEntries, setShareEntries] = useState<ZipEntry[]>([])
  const [sharing, setSharing] = useState(false)

  const runBatch = async () => {
    const eligible = faces.filter((face) => face.landmarks && !face.failed && !face.detecting)
    if (!eligible.length || running) return

    setRunning(true)
    setDone(0)
    setShareEntries([])
    setStatus('Preparing natural retouch…')
    let failed = 0
    const results: ZipEntry[] = []
    const usedNames = new Set<string>()

    // Gentle defaults: preserve facial geometry and avoid strong smoothing.
    const naturalSettings = {
      ...DEFAULT_EDIT_SETTINGS,
      skinSmooth: 0.28,
      teethWhiten: 0.12,
      browDefine: 0.08,
      blush: 0,
      lipColor: null,
      eyeColor: null,
      hairColor: null,
      background: 'none' as const,
      backgroundStrength: 0,
      vignette: 0,
      smile: 0,
      eyeSize: 0,
      noseSlim: 0,
      faceSlim: 0,
      hairVolume: 0,
      ageEnabled: false,
    }

    try {
      for (let i = 0; i < eligible.length; i++) {
        const face = eligible[i]
        setStatus(`Retouching ${i + 1} of ${eligible.length}: ${face.name}`)
        try {
          const parsing = await getParsing(face)
          const result = await computeEdit(face, parsing, naturalSettings)
          const blob = await exportPng(result, 1)
          const baseName = face.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || `portrait-${i + 1}`
          let filename = `${baseName}-retouched.png`
          if (usedNames.has(filename.toLowerCase())) filename = `${baseName}-${i + 1}-retouched.png`
          usedNames.add(filename.toLowerCase())
          results.push({ name: filename, blob })
        } catch (error) {
          console.error('Batch retouch failed for', face.name, error)
          failed++
        }
        setDone(i + 1)
        // Let the mobile browser paint progress between compute-heavy photos.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      if (results.length === 0) {
        setStatus(`No photos could be retouched. ${failed} failed; check that faces are detected and try again.`)
        return
      }

      setStatus(`Packaging ${results.length} edited photo${results.length === 1 ? '' : 's'} into one ZIP…`)
      setShareEntries(results)
      const archive = await exportZip(results)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadBlob(archive, `facestudio-retouched-${stamp}.zip`)
      setStatus(`Finished: ${results.length} saved in one ZIP, ${failed} failed. Open Downloads to extract your portraits.`)
    } catch (error) {
      console.error('Batch export failed', error)
      setStatus('The batch could not be packaged. Try a smaller batch or check available phone storage.')
    } finally {
      setRunning(false)
    }
  }

  const shareRetouchedPhotos = async () => {
    if (!shareEntries.length || sharing) return
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean
      share?: (data?: ShareData) => Promise<void>
    }
    const files = shareEntries.map((entry) => new File([entry.blob], entry.name, { type: 'image/png' }))
    if (!nav.share || !nav.canShare?.({ files })) {
      setStatus('This browser cannot share multiple images directly. Your ZIP is still in Downloads; extract it and use your Gallery app to import the photos.')
      return
    }
    setSharing(true)
    try {
      await nav.share({ files, title: 'FaceStudio retouched photos', text: 'Retouched on this device.' })
      setStatus(`Shared ${files.length} retouched photo${files.length === 1 ? '' : 's'}. Choose a compatible Photos or Gallery destination if it appears.`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus('Sharing cancelled. Your ZIP remains available in Downloads.')
      } else {
        console.error('Sharing retouched photos failed', error)
        setStatus('Sharing was unavailable. Your ZIP remains available in Downloads.')
      }
    } finally {
      setSharing(false)
    }
  }

  const eligibleCount = faces.filter((face) => face.landmarks && !face.failed && !face.detecting).length

  return (
    <section className="card p-3 mt-3 flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-content">Batch natural retouch</h3>
      <p className="text-xs text-muted">
        Retouches all loaded photos with detected faces on this device, then downloads one ZIP.
        Gentle skin smoothing; facial shape is unchanged. Photos are not uploaded.
      </p>
      <button className="btn-accent w-full text-xs" disabled={running || eligibleCount === 0} onClick={runBatch}>
        {running ? 'Processing batch…' : `Retouch & download ZIP (${eligibleCount} photo${eligibleCount === 1 ? '' : 's'})`}
      </button>
      {shareEntries.length > 0 && (
        <button className="btn w-full text-xs" disabled={running || sharing} onClick={shareRetouchedPhotos}>
          {sharing ? 'Opening Android share menu…' : `Share ${shareEntries.length} retouched photo${shareEntries.length === 1 ? '' : 's'} to an app`}
        </button>
      )}
      {running && (
        <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${eligibleCount ? (done / eligibleCount) * 100 : 0}%` }} />
        </div>
      )}
      {status && <p role="status" aria-live="polite" className="text-xs text-muted">{status}</p>}
    </section>
  )
}

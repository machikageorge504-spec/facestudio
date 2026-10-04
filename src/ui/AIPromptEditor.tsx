import { useRef, useState } from 'react'
import { exportZip, type ZipEntry } from '../engine/export'

type Preview = { name: string; url: string }
type ApiResponse = { image?: string; mimeType?: string; error?: string }

const DEFAULT_PROMPT = 'Professionally retouch this portrait to a premium high-end editorial photography standard. Preserve the subject’s exact identity, facial structure, facial proportions, symmetry, expression, skin tone, hairstyle, pose, body shape, clothing, and original framing. Remove temporary blemishes naturally while retaining pores and fine skin texture. Correct lighting and white balance, improve clarity and detail, and keep the result realistic—not plastic or over-smoothed. Do not reshape the face or body.'

function apiUrl() {
  return (import.meta.env.VITE_AI_EDIT_API_URL as string | undefined)?.trim().replace(/\/$/, '') ?? ''
}

export function AIPromptEditor() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [previews, setPreviews] = useState<Preview[]>([])
  const [outputs, setOutputs] = useState<ZipEntry[]>([])

  const selectFiles = (list: FileList | null) => {
    if (!list) return
    const chosen = Array.from(list).filter((file) => file.type.startsWith('image/'))
    setFiles((old) => [...old, ...chosen].slice(0, 20))
    setOutputs([])
    setPreviews([])
    setStatus(chosen.length ? `Added ${chosen.length} photo(s). Maximum 20 per batch.` : 'Choose image files to continue.')
  }

  const run = async () => {
    if (busy || !files.length) return
    const endpoint = apiUrl()
    if (!endpoint) {
      setStatus('AI editing is not connected yet. The service owner must deploy the secure Worker and configure VITE_AI_EDIT_API_URL in the site build.')
      return
    }
    if (!prompt.trim()) {
      setStatus('Write an editing prompt first.')
      return
    }
    setBusy(true)
    setProgress(0)
    setOutputs([])
    setPreviews([])
    const results: ZipEntry[] = []
    const thumbs: Preview[] = []
    const seen = new Set<string>()
    let failed = 0
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setStatus(`AI editing photo ${i + 1} of ${files.length}: ${file.name}`)
        try {
          const form = new FormData()
          form.set('image', file, file.name)
          form.set('prompt', prompt)
          const response = await fetch(endpoint, { method: 'POST', body: form })
          const data = await response.json() as ApiResponse
          if (!response.ok || !data.image) throw new Error(data.error || `Photo edit failed (HTTP ${response.status}).`)
          const binary = atob(data.image)
          const bytes = new Uint8Array(binary.length)
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
          const blob = new Blob([bytes], { type: data.mimeType || 'image/png' })
          const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || `portrait-${i + 1}`
          let name = `${stem}-ai-edited.png`
          if (seen.has(name.toLowerCase())) name = `${stem}-${i + 1}-ai-edited.png`
          seen.add(name.toLowerCase())
          results.push({ name, blob })
          thumbs.push({ name, url: URL.createObjectURL(blob) })
        } catch (error) {
          failed++
          setStatus(`Photo ${i + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}. Continuing with the next photo…`)
        }
        setProgress(i + 1)
        setPreviews([...thumbs])
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      setOutputs(results)
      if (!results.length) {
        setStatus(`No images were edited successfully (${failed} failed). Check the AI service setup and try again.`)
      } else {
        setStatus(`Completed ${results.length} of ${files.length} photo(s); ${failed} failed. Review the previews, then download the results.`)
      }
    } finally {
      setBusy(false)
    }
  }

  const downloadAll = async () => {
    if (!outputs.length) return
    try {
      const zip = await exportZip(outputs)
      const url = URL.createObjectURL(zip)
      const link = document.createElement('a')
      link.href = url
      link.download = `facestudio-ai-edited-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      setStatus('Could not package the results. Try a smaller batch.')
    }
  }

  return (
    <section className="card p-3 mt-3 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-content">AI prompt editor</h3>
        <p className="text-xs text-muted mt-1">Upload portraits, describe the edits in your own words, and process them one by one. AI processing sends each selected photo to the configured AI service.</p>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => selectFiles(event.target.files)} />
      <button className="btn w-full text-xs" disabled={busy || files.length >= 20} onClick={() => inputRef.current?.click()}>
        Add photos {files.length ? `(${files.length}/20 selected)` : ''}
      </button>
      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="flex items-center gap-2 text-xs text-muted">
              <span className="flex-1 truncate">{file.name}</span>
              <button className="text-muted hover:text-content" disabled={busy} aria-label={`Remove ${file.name}`} onClick={() => setFiles((old) => old.filter((_, index) => index !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn-ghost text-xs self-start" disabled={busy} onClick={() => { setFiles([]); setOutputs([]); setPreviews([]); setStatus('Selection cleared.') }}>Clear selection</button>
        </div>
      )}
      <label className="text-xs font-medium text-content" htmlFor="ai-edit-prompt">Your editing prompt</label>
      <textarea id="ai-edit-prompt" className="w-full min-h-36 rounded-xl border border-line bg-surface p-3 text-xs text-content focus:outline-none focus:ring-1 focus:ring-accent" maxLength={4000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe exactly how you want the photos edited…" />
      <p className="text-[10px] text-muted">Identity-preservation instructions are also applied automatically. Up to 4,000 characters.</p>
      <button className="btn-accent w-full text-xs" disabled={busy || files.length === 0 || !prompt.trim()} onClick={run}>
        {busy ? 'AI editing…' : `Edit ${files.length} photo${files.length === 1 ? '' : 's'} with prompt`}
      </button>
      {busy && <div className="h-1.5 rounded-full bg-surface3 overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${files.length ? progress / files.length * 100 : 0}%` }} /></div>}
      {status && <p role="status" aria-live="polite" className="text-xs text-muted">{status}</p>}
      {previews.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {previews.map((preview) => (
            <figure key={preview.name} className="min-w-0">
              <img src={preview.url} alt={preview.name} className="w-full rounded-lg object-contain bg-surface3 max-h-52" />
              <figcaption className="text-[10px] text-muted mt-1 truncate">{preview.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {outputs.length > 0 && <button className="btn-accent w-full text-xs" onClick={downloadAll}>Download {outputs.length} edited photo(s) as ZIP</button>}
    </section>
  )
}

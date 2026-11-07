/** Drag payload from the library / gallery onto the canvas. */
export const DND_MIME = 'application/x-hzc-node'

export type DragPayload =
  | { type: string; profileId?: string }
  | { type: 'text'; text: string; label?: string }
  | { type: 'image' | 'video' | 'audio'; assetId: string; mime: string; name?: string }

export function startDrag(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'copyMove'
}

export function readDrag(e: React.DragEvent): DragPayload | undefined {
  const raw = e.dataTransfer.getData(DND_MIME)
  if (!raw) return undefined
  try { return JSON.parse(raw) as DragPayload } catch { return undefined }
}

export const mediaKind = (mime: string): 'image' | 'video' | 'audio' | undefined =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : undefined

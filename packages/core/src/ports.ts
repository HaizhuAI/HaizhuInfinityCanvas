/**
 * Port (handle) data types. Connections are only allowed between compatible types.
 * `storyboard` is the JSON shot list produced by director skills / video reverse.
 */
export const PORT_TYPES = ['text', 'image', 'video', 'audio', 'storyboard', 'any'] as const
export type PortType = (typeof PORT_TYPES)[number]

export interface PortSpec {
  id: string
  type: PortType
  label: string
  /** accepts multiple incoming edges (inputs only) */
  multiple?: boolean
}

/** Explicit, one-way implicit conversions. Everything else must match exactly. */
const IMPLICIT: Partial<Record<PortType, PortType[]>> = {
  // a storyboard can be flattened to text (e.g. fed to an LLM)
  storyboard: ['text'],
}

export function canConnect(from: PortType, to: PortType): boolean {
  if (from === 'any' || to === 'any') return true
  if (from === to) return true
  return IMPLICIT[from]?.includes(to) ?? false
}

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SUBJECT_KIND_LABEL, isSubjectName, type SubjectKind } from '@hzc/core'
import { assetUrl } from './api'
import { useStore } from './store'

interface Option { name: string; kind: SubjectKind; thumb?: string }

/** the subjects on this canvas, as plain strings (so moving nodes doesn't re-render prompt boxes) */
function useSubjectOptions(): Option[] {
  const rows = useStore(useShallow((s) => s.nodes.filter((n) => n.type === 'subject').map((n) => {
    const p = n.data.params ?? {}
    const img = Array.isArray(p.images) ? (p.images[0] as { assetId?: string } | undefined)?.assetId ?? '' : ''
    return [String(p.name ?? '').trim(), String(p.kind ?? 'character'), img].join('\u0000')
  })))
  return useMemo(() => {
    const seen = new Set<string>()
    return rows.map((r) => r.split('\u0000')).filter(([name]) => isSubjectName(name) && !seen.has(name!) && (seen.add(name!), true))
      .map(([name, kind, img]) => ({ name: name!, kind: (kind as SubjectKind) in SUBJECT_KIND_LABEL ? (kind as SubjectKind) : 'character', thumb: img ? assetUrl(img) : undefined }))
  }, [rows])
}

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onValue: (v: string) => void }

/**
 * A textarea that suggests the canvas's subjects after `@` (↑ ↓ to choose, Enter / Tab to insert,
 * Esc to close). With no subjects on the canvas it behaves like a plain textarea.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, onValue, onKeyDown, className, ...rest }, outer) {
  const options = useSubjectOptions()
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(outer, () => ref.current!)
  const [query, setQuery] = useState<string | null>(null)
  // where the caret goes once an inserted mention is on screen: set before any further keystroke is
  // handled (deferring it to the next frame let fast typing land in front of the caret)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && caret.current !== null && el.value === value) { el.setSelectionRange(caret.current, caret.current); caret.current = null }
  }, [value])
  const [active, setActive] = useState(0)
  const matches = query === null ? [] : options.filter((o) => o.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6)
  const open = matches.length > 0

  function update(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    const m = /(?:^|[^\w@])@([^\s@]{0,24})$/.exec(before)
    setQuery(m && options.length ? m[1]! : null)
    setActive(0)
  }

  function insert(o: Option) {
    const el = ref.current
    if (!el) return
    const at = el.selectionStart ?? value.length
    const before = value.slice(0, at).replace(/@([^\s@]{0,24})$/, `@${o.name} `)
    const next = before + value.slice(at)
    caret.current = before.length
    onValue(next)
    setQuery(null)
    el.focus()
  }

  return (
    <div className="mention-wrap">
      <textarea {...rest} ref={ref} className={className} value={value}
        onChange={(e) => { onValue(e.target.value); update(e.target) }}
        onClick={(e) => update(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); insert(matches[active]!); return }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return }
          }
          onKeyDown?.(e)
        }} />
      {open && (
        <div className="mention-list nodrag" role="listbox" aria-label="引用主体" data-testid="mention-list">
          {matches.map((o, i) => (
            <button type="button" key={o.name} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); insert(o) }} data-testid="mention-option">
              {o.thumb ? <img src={o.thumb} alt="" /> : <span className="mention-blank" />}
              <span className="mention-name">@{o.name}</span>
              <span className="mention-kind">{SUBJECT_KIND_LABEL[o.kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

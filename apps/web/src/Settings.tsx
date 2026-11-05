import { useState } from 'react'
import { ADAPTERS, MODEL_KINDS, type AdapterId, type ModelKind, type ModelProfileInput, type ModelProfilePublic } from '@hzc/core'
import { api, getToken, setToken } from './api'
import { useStore } from './store'

const KIND_LABEL: Record<ModelKind, string> = { llm: '文本模型', vlm: '视觉分析', image: '图片生成', video: '视频生成', tts: '语音 TTS' }

const blank = (): ModelProfileInput & { id?: string } => ({ name: '', kind: 'llm', adapter: 'openai-compat', endpoint: '', model: '', apiKey: '' })

export function Settings() {
  const { profiles, loadProfiles, setSettingsOpen, showToast } = useStore()
  const [form, setForm] = useState<(ModelProfileInput & { id?: string }) | null>(null)
  const [token, setTok] = useState(getToken())
  const [err, setErr] = useState('')

  const edit = (p: ModelProfilePublic) => setForm({ id: p.id, name: p.name, kind: p.kind, adapter: p.adapter, endpoint: p.endpoint, model: p.model, apiKey: undefined })

  async function submit() {
    if (!form) return
    setErr('')
    try {
      const { id, ...input } = form
      // empty apiKey on create = none; on edit undefined = keep existing
      if (!id && !input.apiKey) delete input.apiKey
      if (id) await api.updateProfile(id, input)
      else await api.createProfile(input)
      await loadProfiles()
      setForm(null)
      showToast('已保存')
    } catch (e) { setErr((e as Error).message) }
  }

  async function remove(p: ModelProfilePublic) {
    if (!confirm(`删除模型档案「${p.name}」？画布上绑定它的节点会提示缺失。`)) return
    await api.deleteProfile(p.id)
    await loadProfiles()
  }

  return (
    <div className="modal-back" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <div className="modal-head">
          <h2>设置 · 模型档案</h2>
          <button onClick={() => setSettingsOpen(false)} aria-label="关闭">✕</button>
        </div>

        {!form && (
          <>
            <p className="muted">每个档案会成为侧边栏里一个可拖入画布的图标。API Key 加密保存在本机服务端，不会回传到浏览器。</p>
            <table className="tbl">
              <thead><tr><th>名称</th><th>类型</th><th>适配器</th><th>模型</th><th>Key</th><th /></tr></thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td><td>{KIND_LABEL[p.kind]}</td><td>{p.adapter}</td><td>{p.model}</td>
                    <td>{p.hasKey ? '已设置' : '—'}</td>
                    <td className="act"><button onClick={() => edit(p)}>编辑</button><button onClick={() => remove(p)}>删除</button></td>
                  </tr>
                ))}
                {profiles.length === 0 && <tr><td colSpan={6} className="muted">暂无档案</td></tr>}
              </tbody>
            </table>
            <button className="primary" onClick={() => setForm(blank())}>＋ 添加模型档案</button>

            <h3 className="mt">访问口令（仅 WebUI 远程部署需要）</h3>
            <div className="row">
              <input type="password" placeholder="HZC_TOKEN" value={token} onChange={(e) => setTok(e.target.value)} />
              <button onClick={() => { setToken(token); showToast('口令已保存到本浏览器'); void loadProfiles() }}>保存</button>
            </div>
          </>
        )}

        {form && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <label>名称<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：Kling 2.5 视频" /></label>
            <label>类型
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ModelKind })}>
                {MODEL_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label>适配器
              <select value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value as AdapterId })}>
                {ADAPTERS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label>接口地址 Endpoint<input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://api.example.com/v1" /></label>
            <label>模型 ID<input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如：gpt-4o / kling-v2" /></label>
            <label>API Key
              <input type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={form.id ? '留空 = 保持不变' : '可留空（本地模型）'} />
            </label>
            {err && <div className="warn">{err}</div>}
            <div className="row">
              <button type="submit" className="primary">保存</button>
              <button type="button" onClick={() => setForm(null)}>取消</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { readZip, zipBuffer, ZipError } from './zip'

// two different 1x1 PNGs (only the signature is checked on import)
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

/** a one-entry archive using deflate, the way most zip tools write it */
function deflatedZip(name: string, data: Buffer) {
  const comp = deflateRawSync(data), n = Buffer.from(name)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10)
  cd.writeUInt32LE(crc32(data), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28)
  const dirOff = 30 + n.length + comp.length
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(dirOff, 16)
  return Buffer.concat([local, n, comp, cd, n, end])
}

describe('zip', () => {
  it('round-trips stored entries with UTF-8 names', () => {
    const z = zipBuffer([{ name: 'a.txt', data: Buffer.from('hello') }, { name: '目录/镜头.bin', data: () => Buffer.alloc(70_000, 7) }])
    const e = readZip(z)
    expect(e.map((x) => x.name)).toEqual(['a.txt', '目录/镜头.bin'])
    expect(e[0]!.data.toString()).toBe('hello')
    expect(e[1]!.data.length).toBe(70_000)
  })
  it('reads deflated entries and rejects damage, bombs and non-zips', () => {
    const text = Buffer.from('x'.repeat(10_000))
    expect(readZip(deflatedZip('p.txt', text))[0]!.data.equals(text)).toBe(true)
    const bad = zipBuffer([{ name: 'a', data: Buffer.from('hello') }]); bad.writeUInt8(bad.readUInt8(31) ^ 0xff, 31) // flip a data byte
    expect(() => readZip(bad)).toThrow(ZipError)
    expect(() => readZip(deflatedZip('big', Buffer.alloc(5000)), { maxTotal: 1000 })).toThrow(/too large/)
    expect(() => readZip(Buffer.from('not a zip at all, just text'))).toThrow(ZipError)
  })
})

describe('project bundle (.hzc)', () => {
  const dirs: string[] = []
  const apps: { app: FastifyInstance; store: Store }[] = []
  async function rig(accessToken?: string) {
    const data = mkdtempSync(join(tmpdir(), 'hzc-bundle-')); dirs.push(data)
    const store = new Store(':memory:', new SecretBox(join(data, 'master.key')))
    const assets = new AssetStore(data, store)
    const skills = new SkillStore(undefined, data)
    const app = await buildApp({ store, assets, engine: new Engine(store, assets, { skills }), skills, accessToken })
    apps.push({ app, store })
    return { store, assets, app }
  }
  afterEach(async () => {
    for (const { app, store } of apps.splice(0)) { await app.close(); store.close() }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  let src: Awaited<ReturnType<typeof rig>>, pid = '', imgA = '', imgB = ''
  beforeEach(async () => {
    src = await rig()
    imgA = src.assets.put(PNG_A, 'image/png', 'a.png').id
    imgB = src.assets.put(PNG_B, 'image/png', 'result.png').id
    src.assets.put(PNG_B, 'image/png', 'unrelated.png') // not referenced -> not bundled
    const p = src.store.createProject('海报', {
      version: 1,
      nodes: [
        { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { assetId: imgA, mime: 'image/png' } },
        { id: 'n2', type: 'text', position: { x: 0, y: 300 }, data: { text: '提示词' } },
      ],
      edges: [],
    })
    pid = p.id
    src.store.setNodeOutput(pid, 'n2', 'key-123', { out: [{ type: 'image', assetId: imgB, mime: 'image/png' }] })
    src.store.setNodeOutput(pid, 'gone', 'k', { out: [] }) // result of a deleted node -> dropped
  })

  const download = async () => {
    const r = await src.app.inject({ method: 'GET', url: `/api/projects/${pid}/bundle` })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/zip')
    expect(r.headers['content-disposition']).toBe('attachment')
    return r.rawPayload
  }
  const upload = (app: FastifyInstance, body: Buffer) => app.inject({ method: 'POST', url: '/api/projects/import', headers: { 'content-type': 'application/zip' }, payload: body })

  it('bundles the graph, its results and only the files they reference', async () => {
    const entries = readZip(await download())
    expect(entries.map((e) => e.name).sort()).toEqual(['assets/' + imgA + '.png', 'assets/' + imgB + '.png', 'project.json'].sort())
    const m = JSON.parse(entries.find((e) => e.name === 'project.json')!.data.toString())
    expect(m).toMatchObject({ format: 'haizhu-project', version: 1, name: '海报' })
    expect(m.outputs).toHaveLength(1)
    expect(m.outputs[0]).toMatchObject({ nodeId: 'n2', cacheKey: 'key-123' })
  })

  it('imports on another machine with the same asset ids, results and cache keys', async () => {
    const zip = await download()
    const dst = await rig()
    const r = await upload(dst.app, zip)
    expect(r.statusCode).toBe(201)
    const body = r.json()
    expect(body).toMatchObject({ assets: 2, missing: 0, results: 1 })
    expect(body.project.name).toBe('海报（导入）')
    expect(body.project.graph.nodes[0].data.assetId).toBe(imgA)
    const img = await dst.app.inject({ method: 'GET', url: `/api/assets/${imgA}` })
    expect(img.statusCode).toBe(200)
    expect(img.rawPayload.equals(PNG_A)).toBe(true)
    expect(dst.store.getNodeOutput(body.project.id, 'n2')).toMatchObject({ cacheKey: 'key-123', outputs: { out: [{ assetId: imgB }] } })
  })

  it('re-imports on the same machine without duplicating ids, and remaps a colliding id', async () => {
    const zip = await download()
    const again = await upload(src.app, zip)
    expect(again.json().project.graph.nodes[0].data.assetId).toBe(imgA)

    const dst = await rig()
    dst.assets.put(PNG_B, 'image/png', 'x', imgA) // same id, different bytes
    const r = (await upload(dst.app, zip)).json()
    const remapped = r.project.graph.nodes[0].data.assetId
    expect(remapped).not.toBe(imgA)
    expect(dst.assets.get(remapped)!.sha256).toBe(src.assets.get(imgA)!.sha256)
  })

  it('rejects files that are not bundles, and keeps zips out of the upload route', async () => {
    expect((await upload(src.app, Buffer.from('hello'))).statusCode).toBe(400)
    expect((await upload(src.app, zipBuffer([{ name: 'x.txt', data: Buffer.from('1') }]))).json().error).toMatch(/project\.json/)
    expect((await upload(src.app, zipBuffer([{ name: 'project.json', data: Buffer.from('{"format":"other"}') }]))).json().error).toMatch(/不受支持/)
    const up = await src.app.inject({ method: 'POST', url: '/api/assets', headers: { 'content-type': 'application/zip' }, payload: zipBuffer([]) })
    expect(up.statusCode).toBe(415)
    expect((await src.app.inject({ method: 'GET', url: '/api/projects/nope/bundle' })).statusCode).toBe(404)
  })

  it('accepts the access token in the query only for asset and bundle downloads', async () => {
    const t = await rig('secret-token')
    const p = t.store.createProject('p')
    expect((await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}/bundle` })).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}/bundle?t=secret-token` })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}?t=secret-token` })).statusCode).toBe(401)
  })
})

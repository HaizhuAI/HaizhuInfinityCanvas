import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Local encrypted secret store (AES-256-GCM). The master key lives in a 0600 file
 * next to the data dir; ciphertext lives in SQLite. Plaintext never reaches the
 * browser: the server makes all provider calls itself.
 *
 * Desktop builds will replace the key source with Electron safeStorage (beta.7).
 */
export class SecretBox {
  private key: Buffer

  constructor(keyPath: string) {
    if (existsSync(keyPath)) {
      this.key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex')
      if (this.key.length !== 32) throw new Error(`invalid master key at ${keyPath}`)
    } else {
      mkdirSync(dirname(keyPath), { recursive: true })
      this.key = randomBytes(32)
      writeFileSync(keyPath, this.key.toString('hex'), { mode: 0o600 })
      try { chmodSync(keyPath, 0o600) } catch { /* best effort on Windows */ }
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.')
  }

  decrypt(payload: string): string {
    const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'))
    if (!iv || !tag || !enc) throw new Error('malformed secret payload')
    const d = createDecipheriv('aes-256-gcm', this.key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  }
}

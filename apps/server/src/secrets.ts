import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs'
import { writeAtomic } from './fsutil'
import { dirname } from 'node:path'

/** A stored secret cannot be decrypted (the master key changed). The message is shown to the user. */
export class SecretError extends Error {}

/**
 * Local encrypted secret store (AES-256-GCM). Ciphertext lives in SQLite; plaintext never
 * reaches the browser (the server makes all provider calls itself). The master key comes from
 * `keyHex` when given (the desktop app unseals it from the OS keychain via Electron safeStorage
 * and passes it as HZC_MASTER_KEY), otherwise from a 0600 file in the data dir.
 */
export class SecretBox {
  private key: Buffer

  constructor(keyPath: string, keyHex?: string) {
    if (keyHex !== undefined) {
      if (!/^[0-9a-f]{64}$/i.test(keyHex.trim())) throw new Error('HZC_MASTER_KEY must be 64 hex characters (32 bytes)')
      this.key = Buffer.from(keyHex.trim(), 'hex')
    } else if (existsSync(keyPath)) {
      this.key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex')
      if (this.key.length !== 32) throw new Error(`invalid master key at ${keyPath}`)
    } else {
      mkdirSync(dirname(keyPath), { recursive: true })
      this.key = randomBytes(32)
      // atomic: a crash while creating it must not leave an empty key that locks every stored API key away
      writeAtomic(keyPath, this.key.toString('hex'), 0o600)
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

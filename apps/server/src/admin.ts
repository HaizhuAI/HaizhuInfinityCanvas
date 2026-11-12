import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { AccountError, AccountStore } from './accounts'
import { Workspaces } from './workspaces'
import type { SecretBox } from './secrets'

/**
 * Operator commands for a multi-user deployment (no email service is needed for any of them):
 *
 *   node server/index.mjs admin users                  list accounts
 *   node server/index.mjs admin create-user <email>    create an account; prints a one-time password
 *   node server/index.mjs admin reset-password <email> new one-time password; signs the user out everywhere
 *   node server/index.mjs admin disable <email>        block sign-in (data kept); `enable` undoes it
 *   node server/index.mjs admin delete-user <email>    delete the account and its whole workspace
 *
 * In Docker: docker compose exec haizhu-canvas node server/index.mjs admin users
 */
export const ADMIN_USAGE = `usage: admin <users | create-user EMAIL | reset-password EMAIL | disable EMAIL | enable EMAIL | delete-user EMAIL>`

/** a password the user is asked to change: 18 characters from an unambiguous alphabet */
function oneTimePassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return [...randomBytes(18)].map((b) => abc[b % abc.length]).join('')
}

export async function runAdmin(args: string[], dataDir: string, secrets: () => SecretBox, out: (s: string) => void = console.log): Promise<number> {
  const [cmd, emailArg] = args
  const accounts = new AccountStore(join(dataDir, 'accounts.sqlite'))
  try {
    const user = () => {
      const u = emailArg ? accounts.findByEmail(emailArg) : undefined
      if (!u) throw new AccountError(emailArg ? `没有这个账号：${emailArg}` : ADMIN_USAGE)
      return u
    }
    switch (cmd) {
      case 'users': {
        const list = accounts.listUsers()
        for (const u of list) out(`${u.email}\t创建于 ${u.createdAt}\t${u.lastLogin ? `最近登录 ${u.lastLogin}` : '从未登录'}${u.disabled ? '\t已停用' : ''}`)
        out(`共 ${list.length} 个账号`)
        return 0
      }
      case 'create-user': {
        const pw = oneTimePassword()
        const u = await accounts.createUser(emailArg, pw)
        out(`已创建 ${u.email}\n临时密码：${pw}\n请让对方登录后在「设置 → 账号」里修改密码。`)
        return 0
      }
      case 'reset-password': {
        const u = user()
        const pw = oneTimePassword()
        await accounts.setPassword(u.id, pw)
        out(`已重置 ${u.email} 的密码，所有设备已退出登录\n临时密码：${pw}`)
        return 0
      }
      case 'disable':
      case 'enable': {
        const u = user()
        accounts.setDisabled(u.id, cmd === 'disable')
        out(cmd === 'disable' ? `已停用 ${u.email}（数据保留，所有设备已退出登录）` : `已恢复 ${u.email}`)
        return 0
      }
      case 'delete-user': {
        const u = user()
        const ws = new Workspaces(dataDir, { secrets: secrets() })
        ws.remove(u.id)
        ws.closeAll()
        accounts.deleteUser(u.id)
        out(`已删除 ${u.email} 及其全部画布、模型档案和文件`)
        return 0
      }
      default:
        out(ADMIN_USAGE)
        return 2
    }
  } catch (e) {
    out(e instanceof AccountError ? e.message : `失败：${(e as Error).message}`)
    return 1
  } finally {
    accounts.close()
  }
}

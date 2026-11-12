'use strict'
/**
 * macOS: ad-hoc sign the app bundle before the .dmg / .zip is made. There is no Apple Developer ID
 * certificate, so it is not notarized (first launch: right-click → Open, or System Settings → Privacy &
 * Security → Open Anyway); but every binary carries a valid signature, which Apple silicon requires.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}

// Release notes for a GitHub Release: the downloads, then this version's Chinese and English changelog
// entries (links made absolute so they work on the release page).
//   node .github/release-notes.mjs 1.0.0-rc.20 > notes.md
// GITHUB_REPOSITORY (owner/repo) and GITHUB_REF_NAME (the tag) are set by GitHub Actions.
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) { console.error('usage: release-notes.mjs <version>'); process.exit(2) }
const repo = process.env.GITHUB_REPOSITORY || 'HaizhuAI/HaizhuInfinityCanvas'
const tag = process.env.GITHUB_REF_NAME || `v${version}`
const image = `ghcr.io/${repo.split('/')[0].toLowerCase()}/haizhu-infinity-canvas`

/** the "## [version]" section of a changelog, without its heading */
function section(file) {
  const text = readFileSync(file, 'utf8')
  const start = text.indexOf(`## [${version}]`)
  if (start < 0) throw new Error(`${file} has no entry for ${version}`)
  const body = text.slice(text.indexOf('\n', start) + 1)
  const end = body.search(/^## \[/m)
  return (end < 0 ? body : body.slice(0, end)).trim()
    .replace(/\]\(\.\/(?!\/)/g, `](https://github.com/${repo}/blob/${tag}/`)
    .replace(/^### /gm, '#### ')
}

const f = (name) => `\`HaizhuInfinityCanvas-${version}-${name}\``
process.stdout.write(`## 下载 / Downloads

| 系统 / System | 文件 / File | 说明 / Notes |
| --- | --- | --- |
| Windows 10 / 11 | ${f('win-x64-setup.exe')} · ${f('win-x64-portable.exe')} | 安装版 / installer · 便携版 / portable；Windows on ARM 可运行 x64 版 |
| macOS 12+ | ${f('mac-arm64.dmg')}（Apple 芯片 / Apple silicon）· ${f('mac-x64.dmg')}（Intel）| 也有 .zip；未公证：第一次右键 → 打开 / not notarized: right-click → Open the first time |
| Linux | \`.AppImage\` · \`.deb\`（x64 / arm64）| AppImage：\`chmod +x\` 后运行 |
| 服务器 / Server（Node.js 22.13+）| \`haizhu-infinity-canvas-${version}-server.tar.gz\` | 解压后 \`./start.sh\`，见包内 README |
| Docker（x64 / arm64）| \`docker pull ${image}:${version}\` | 见仓库中的 \`docker-compose.yml\` |

- 校验 / checksums：\`SHA256SUMS.txt\`。
- 安装包没有代码签名：Windows 若出现 SmartScreen，点「更多信息 → 仍要运行」。The installers are not code-signed: on Windows choose "More info → Run anyway" if SmartScreen appears.
- 桌面版的视频反推、拆镜头与导出成片需要自行安装 FFmpeg；Docker 镜像已内置。Desktop video features need FFmpeg installed; the Docker image includes it.
- Docker 镜像内的 FFmpeg 来自 Debian 官方软件包（GPL 构建，未修改），版权文件在镜像的 \`/usr/share/doc/ffmpeg/\`，对应源码见 https://sources.debian.org/src/ffmpeg/ 。The image's FFmpeg is Debian's unmodified package (GPL build); its copyright files are in \`/usr/share/doc/ffmpeg/\` and the source is at https://sources.debian.org/src/ffmpeg/ .

<details open><summary><b>更新说明（中文）</b></summary>

${section('CHANGELOG.md')}

</details>

<details><summary><b>Release notes (English)</b></summary>

${section('CHANGELOG.en.md')}

</details>
`)

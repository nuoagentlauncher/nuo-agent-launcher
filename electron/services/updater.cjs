// 更新检测 + 自动更新服务
// 功能：检查 GitHub Releases 最新版本、获取全部版本更新日志、打开下载页
//       应用内下载更新包（镜像加速 + 自动测速 + 失败回退）并自动安装/替换重启
// 网络策略：api.github.com 在部分网络环境下 DNS 会被污染，
//           先按系统默认 DNS 请求，失败后自动通过直连 IP（SNI 保留域名）回退。
//           release 资产下载支持 GH Proxy 类镜像前缀代理（国内直连 GitHub 慢）。
const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { app, shell } = require('electron')
const { logger } = require('./logger.cjs')
const { getConfig } = require('./config.cjs')

const REPO = 'nuoagentlauncher/nuo-agent-launcher'
const API_HOST = 'api.github.com'
const FALLBACK_IPS = ['140.82.112.6', '140.82.113.6', '20.205.243.168']
const RELEASES_URL = `https://github.com/${REPO}/releases`
const UA = 'nuo-agent-launcher-updater'

// GitHub 下载镜像（前缀代理格式：https://ghfast.top/https://github.com/...）
// 作用：国内直连 github.com 下载 release 资产慢/易失败，镜像由服务端代取
const MIRRORS = [
  { key: 'ghfast', name: 'GHFast 镜像', prefix: 'https://ghfast.top/' },
  { key: 'ghproxy', name: 'GH-Proxy 镜像', prefix: 'https://gh-proxy.com/' },
  { key: 'ghproxynet', name: 'GHProxy.NET 镜像', prefix: 'https://ghproxy.net/' },
  { key: 'gitmirror', name: 'GitMirror 镜像', prefix: 'https://hub.gitmirror.com/' },
]

function currentVersion() {
  try { return require('../../package.json').version } catch { return '0.0.0' }
}

// 语义化版本比较：a>b → 1，a===b → 0，a<b → -1（容忍前导 v）
function compareVersions(a, b) {
  const norm = (s) => String(s || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pa = norm(a)
  const pb = norm(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

// 单次 HTTPS GET JSON（可选直连 IP + SNI）
function httpsGetJson(reqPath, ip, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: ip || API_HOST,
      port: 443,
      path: reqPath,
      method: 'GET',
      servername: API_HOST,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
        'X-GitHub-Api-Version': '2022-11-28',
        Host: API_HOST,
        Connection: 'close',
      },
      timeout: 8000,
    }, (res) => {
      // 跟随重定向
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.resume()
        const loc = res.headers.location
        // 重定向一般去 codeload / objects 等域名，直接用默认 https.get
        https.get(loc, { headers: { 'User-Agent': UA } }, (r2) => {
          let d = ''
          r2.on('data', (c) => { d += c; if (d.length > 4 * 1024 * 1024) req.destroy() })
          r2.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
        }).on('error', reject)
        return
      }
      let data = ''
      res.on('data', (c) => { data += c; if (data.length > 4 * 1024 * 1024) req.destroy() })
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)); return }
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    req.end()
  })
}

// 带 DNS 污染回退的请求：默认 DNS → 依次直连 IP
async function apiGet(reqPath) {
  let lastErr = null
  // 1. 默认 DNS
  try {
    return await new Promise((resolve, reject) => {
      const req = https.get({
        hostname: API_HOST,
        port: 443,
        path: reqPath,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': UA,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 6000,
      }, (res) => {
        let data = ''
        res.on('data', (c) => { data += c; if (data.length > 4 * 1024 * 1024) req.destroy() })
        res.on('end', () => {
          if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('默认线路超时')))
      req.on('error', reject)
    })
  } catch (e) {
    lastErr = e
  }
  // 2. 直连 IP 回退
  for (const ip of FALLBACK_IPS) {
    try {
      logger.info('updater', `默认线路失败，通过 IP ${ip} 回退`, { error: lastErr?.message })
      return await httpsGetJson(reqPath, ip)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('更新检查失败：所有线路均不可用')
}

function serializeRelease(r) {
  return {
    version: String(r.tag_name || '').replace(/^v/, ''),
    name: r.name || r.tag_name,
    notes: r.body || '',
    url: r.html_url,
    prerelease: !!r.prerelease,
    draft: !!r.draft,
    publishedAt: r.published_at,
    assets: (r.assets || []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
      downloads: a.download_count,
    })),
  }
}

// 检查更新：静默模式不抛错只返回
async function checkUpdate({ silent = false } = {}) {
  const current = currentVersion()
  try {
    const latest = await apiGet(`/repos/${REPO}/releases/latest`)
    const info = serializeRelease(latest)
    const hasUpdate = compareVersions(info.version, current) > 0
    const result = {
      success: true,
      hasUpdate,
      current,
      latest: info.version,
      release: info,
      checkedAt: new Date().toISOString(),
    }
    logger.info('updater', '版本检查完成', { current, latest: info.version, hasUpdate })
    return result
  } catch (e) {
    logger.warn('updater', '版本检查失败', { error: e.message })
    if (silent) return { success: false, error: e.message, current, hasUpdate: false }
    throw new Error(`检查更新失败：${e.message}`)
  }
}

// 获取全部版本（更新日志页用）
async function listReleases() {
  const list = await apiGet(`/repos/${REPO}/releases?per_page=100`)
  return (Array.isArray(list) ? list : []).filter((r) => !r.draft).map(serializeRelease)
}

function openReleases() {
  return shell.openExternal(RELEASES_URL)
}

function openUrl(_e, url) {
  if (typeof url === 'string' && /^https:\/\//.test(url)) return shell.openExternal(url)
  return false
}

// ==================== 自更新：镜像加速 + 应用内下载 + 自动安装 ====================

let _mainWindowGetter = null
let _downloadJob = null // { taskId, running, cancel, version }

// 推送下载进度到渲染进程（仿 downloader.cjs pushProgress 模式）
function pushProgress(data) {
  data.timestamp = Date.now()
  const win = _mainWindowGetter && _mainWindowGetter()
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('updater:download-progress', data) } catch {}
  }
  if (data.message) logger.info('updater', `[selfupdate] ${data.message}`, { phase: data.phase, percent: data.percent })
}

// 当前安装形态：dev（未打包）/ portable（便携版）/ nsis（安装版）
// electron-builder portable 目标运行时会设置 PORTABLE_EXECUTABLE_FILE 指向真实的 exe；
// 此时 process.execPath 指向 %TEMP% 里的解包副本，替换时必须用 PORTABLE_EXECUTABLE_FILE
function detectVariant() {
  if (app.isPackaged === false) return 'dev'
  const pf = process.env.PORTABLE_EXECUTABLE_FILE
  if (pf && /\.exe$/i.test(pf) && fs.existsSync(pf)) return 'portable'
  return 'nsis'
}

// 启动时清理便携版自我替换留下的旧文件残留（xxx.exe.old）
function cleanupOldBinary() {
  const pf = process.env.PORTABLE_EXECUTABLE_FILE
  if (!pf) return
  try { if (fs.existsSync(pf + '.old')) fs.rmSync(pf + '.old', { force: true }) } catch {}
}

// 镜像测速：Range 0-0 请求量到首个最终响应的耗时（部分镜像不支持 Range，返回 200 也算可用）
function probeMirror(mirror, targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(mirror.prefix + targetUrl)
    const started = Date.now()
    const finish = (res) => {
      const ms = Date.now() - started
      res.resume()
      try { res.destroy() } catch {}
      if (res.statusCode === 200 || res.statusCode === 206) resolve({ mirror, ms })
      else reject(new Error(`HTTP ${res.statusCode}`))
    }
    const followOnce = (loc) => {
      const u2 = new URL(loc, u)
      const r = https.get({
        hostname: u2.hostname, port: 443, path: u2.pathname + u2.search,
        headers: { 'User-Agent': UA, Range: 'bytes=0-0', Connection: 'close' },
        timeout: 8000,
      }, finish)
      r.on('error', reject)
    }
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-0', Connection: 'close' },
      timeout: 8000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        return followOnce(res.headers.location)
      }
      finish(res)
    })
    req.on('timeout', () => req.destroy(new Error('测速超时')))
    req.on('error', reject)
    req.end()
  })
}

// 根据 updateMirror 配置生成候选下载 URL 序列（镜像优先，官方直连兜底）
async function buildCandidateUrls(assetUrl) {
  const cfg = getConfig()
  const mirrorCfg = cfg.updateMirror || 'auto'
  const mirrorUrl = (m) => m.prefix + assetUrl
  if (mirrorCfg === 'direct') return [assetUrl]
  if (mirrorCfg === 'auto') {
    const probes = await Promise.allSettled(MIRRORS.map((m) => probeMirror(m, assetUrl)))
    const ok = probes
      .filter((p) => p.status === 'fulfilled')
      .map((p) => p.value)
      .sort((a, b) => a.ms - b.ms)
    if (ok.length) {
      logger.info('updater', '[selfupdate] 镜像测速完成', { ranked: ok.map((o) => `${o.mirror.key}:${o.ms}ms`) })
      pushProgress({ phase: 'probe', percent: 2, message: `已选中最快线路：${ok[0].mirror.name}` })
    }
    const rest = MIRRORS.filter((m) => !ok.some((o) => o.mirror.key === m.key))
    return [...ok.map((o) => mirrorUrl(o.mirror)), ...rest.map(mirrorUrl), assetUrl]
  }
  // 指定镜像：该镜像优先，其余镜像次之，官方直连兜底
  const chosen = MIRRORS.find((m) => m.key === mirrorCfg)
  const others = MIRRORS.filter((m) => m.key !== mirrorCfg)
  return [...(chosen ? [mirrorUrl(chosen)] : []), ...others.map(mirrorUrl), assetUrl]
}

function sourceLabel(url) {
  const m = MIRRORS.find((x) => url.startsWith(x.prefix))
  return m ? m.name : '官方直连'
}

// 下载到文件：.part 临时文件 → 完成后 rename；进度节流推送；支持取消
function downloadTo(url, destPath, onProgress, isCancelled) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.get({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { 'User-Agent': UA, Connection: 'close' },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        return resolve(downloadTo(new URL(res.headers.location, u).href, destPath, onProgress, isCancelled))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      const dir = path.dirname(destPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const file = fs.createWriteStream(destPath + '.part')
      let received = 0
      let lastPush = 0
      const startTime = Date.now()
      res.on('data', (chunk) => {
        if (isCancelled()) {
          req.destroy(new Error('已取消'))
          return
        }
        received += chunk.length
        file.write(chunk)
        const now = Date.now()
        if (onProgress && (now - lastPush > 150 || (total && received >= total))) {
          lastPush = now
          onProgress({ received, total, speed: received / ((now - startTime) / 1000 || 1) })
        }
      })
      res.on('error', (e) => {
        file.end(() => { try { fs.unlinkSync(destPath + '.part') } catch {} })
        reject(e)
      })
      res.on('end', () => {
        file.end(() => {
          try {
            fs.renameSync(destPath + '.part', destPath)
            resolve({ received, total })
          } catch (e) { reject(e) }
        })
      })
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', (e) => {
      try { fs.unlinkSync(destPath + '.part') } catch {}
      reject(e)
    })
  })
}

// 生成"等待进程退出后执行"的批处理脚本（内容纯 ASCII，路径经环境变量传入，规避中文/空格路径编码问题）
function writeUpdateScript(variant, installerPath) {
  const wait = [
    ':waitloop',
    'tasklist /FI "PID eq %NAL_PID%" | find "%NAL_PID%" >nul',
    'if not errorlevel 1 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto waitloop',
    ')',
    'ping -n 3 127.0.0.1 >nul',
  ]
  let lines
  if (variant === 'portable') {
    // 便携版：旧 exe 改名为 .old（运行中的 exe 允许改名不允许覆盖）→ 新 exe 移入原位 → 启动新版 → 脚本自删
    lines = [
      '@echo off',
      ...wait,
      'set ATTEMPT=0',
      ':retry',
      'move /y "%NAL_TARGET%" "%NAL_TARGET%.old" >nul 2>&1',
      'if not exist "%NAL_TARGET%" goto replace',
      'set /a ATTEMPT=ATTEMPT+1',
      'if %ATTEMPT% geq 4 goto giveup',
      'ping -n 3 127.0.0.1 >nul',
      'goto retry',
      ':replace',
      'move /y "%NAL_NEW_EXE%" "%NAL_TARGET%" >nul 2>&1',
      'if exist "%NAL_TARGET%" start "" "%NAL_TARGET%"',
      'del /q "%~f0" >nul 2>&1',
      'exit /b',
      ':giveup',
      'del /q "%~f0" >nul 2>&1',
      'exit /b',
    ]
  } else {
    // 安装版：等待退出后启动安装向导（assisted installer，用户点下一步即可）
    lines = [
      '@echo off',
      ...wait,
      'start "" "%NAL_NEW_EXE%"',
      'del /q "%~f0" >nul 2>&1',
      'exit /b',
    ]
  }
  const scriptPath = path.join(os.tmpdir(), `nal-update-${Date.now()}.cmd`)
  fs.writeFileSync(scriptPath, lines.join('\r\n') + '\r\n', 'utf8')
  return scriptPath
}

// 执行安装并退出当前应用
function installAndRestart(installerPath, variant) {
  const scriptPath = writeUpdateScript(variant, installerPath)
  const env = {
    ...process.env,
    NAL_PID: String(process.pid),
    NAL_NEW_EXE: installerPath,
  }
  if (variant === 'portable') env.NAL_TARGET = process.env.PORTABLE_EXECUTABLE_FILE
  const child = spawn('cmd.exe', ['/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  })
  child.unref()
  logger.info('updater', `[selfupdate] 已启动安装脚本（${variant}），应用即将退出`, { installerPath })
  setTimeout(() => { try { app.quit() } catch {} }, 500)
}

// 一键更新主流程：检查 → 选线路 → 下载（回退）→ 校验 → 安装重启
async function downloadAndInstall() {
  if (_downloadJob && _downloadJob.running) return { success: false, error: '已有更新下载正在进行' }
  const variant = detectVariant()
  if (variant === 'dev') return { success: false, error: '开发模式下不支持自更新，请用打包后的版本体验' }
  const job = { taskId: 'selfupdate-' + Date.now(), running: true, cancel: false }
  _downloadJob = job
  try {
    pushProgress({ phase: 'check', percent: 0, message: '正在检查最新版本...' })
    const check = await checkUpdate({ silent: false })
    if (!check.hasUpdate) {
      job.running = false
      pushProgress({ phase: 'idle', percent: 100, message: '当前已是最新版本' })
      return { success: false, error: '当前已是最新版本' }
    }
    const rel = check.release
    const pattern = variant === 'portable' ? /portable|便携/i : /setup|安装|nsis/i
    const asset = (rel.assets || []).find((a) => pattern.test(a.name))
    if (!asset) {
      job.running = false
      pushProgress({ phase: 'idle', percent: 100, message: '未找到适配当前安装方式的更新包' })
      return { success: false, error: `最新版本 v${rel.version} 未提供${variant === 'portable' ? '便携版' : '安装版'}更新包，请到 GitHub Releases 手动下载` }
    }

    const urls = await buildCandidateUrls(asset.url)
    const dest = path.join(os.tmpdir(), `nal-update-${rel.version}.exe`)
    let lastErr = null
    let downloaded = false
    for (let i = 0; i < urls.length; i++) {
      if (job.cancel) throw new Error('已取消')
      const url = urls[i]
      try {
        logger.info('updater', `[selfupdate] 下载线路 ${i + 1}/${urls.length}`, { url })
        const { received } = await downloadTo(url, dest, (p) => {
          const percent = p.total ? Math.min(99, 3 + (p.received / p.total) * 94) : 3
          pushProgress({
            phase: 'download',
            percent,
            received: p.received,
            total: p.total,
            speed: p.speed,
            message: `正在下载 v${rel.version}（${sourceLabel(url)}）`,
          })
        }, () => job.cancel)
        if (asset.size && received !== asset.size) throw new Error(`文件大小校验失败（${received}/${asset.size} 字节）`)
        downloaded = true
        break
      } catch (e) {
        lastErr = e
        if (job.cancel) throw new Error('已取消')
        logger.warn('updater', '[selfupdate] 线路失败，切换下一候选', { url, error: e.message })
        try { fs.unlinkSync(dest + '.part') } catch {}
      }
    }
    if (!downloaded) throw lastErr || new Error('所有下载线路均失败，请检查网络后在设置中更换更新镜像')

    job.running = false
    pushProgress({ phase: 'install', percent: 100, message: '下载完成，正在启动安装...' })
    installAndRestart(dest, variant)
    return { success: true, version: rel.version, variant }
  } catch (e) {
    job.running = false
    pushProgress({ phase: 'error', percent: 100, message: '自动更新失败：' + e.message })
    logger.error('updater', '[selfupdate] 自动更新失败', { error: e.message })
    return { success: false, error: e.message }
  }
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow || null
  cleanupOldBinary()
  ipcMain.handle('updater:check', (_e, opts) => checkUpdate(opts || {}))
  ipcMain.handle('updater:releases', listReleases)
  ipcMain.handle('updater:open-releases', openReleases)
  ipcMain.handle('updater:open-url', openUrl)
  ipcMain.handle('updater:download-install', () => downloadAndInstall())
  ipcMain.handle('updater:cancel-download', () => {
    if (_downloadJob && _downloadJob.running) {
      _downloadJob.cancel = true
      return true
    }
    return false
  })
  ipcMain.handle('updater:variant', () => detectVariant())
}

module.exports = { register, checkUpdate, listReleases, compareVersions, currentVersion, detectVariant, downloadAndInstall, MIRRORS }

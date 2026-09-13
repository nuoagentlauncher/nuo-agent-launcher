// Minecraft 基岩版（Windows UWP）下载服务
// 数据源（全部官方）：
//   - 商店包列表：rg-adguard 商店接口（返回微软官方 CDN 直链 tlu.dl.delivery.mp.microsoft.com）
//     · 正式版产品 Minecraft for Windows   9NBLGGH2JHXJ（包名 Microsoft.MinecraftUWP）
//     · 预览版产品 Minecraft Preview        9P5X4QVLC2XR（包名 Microsoft.MinecraftWindowsBeta）
//   - 游戏版本号（如 26.45，即应用商店/苹果商店展示的版本）：minecraft.wiki 官方资料接口
// 安装：Add-AppxPackage；启动：UWP appsFolder 协议
const fs = require('fs')
const path = require('path')
const https = require('https')
const { execFile } = require('child_process')
const { logger } = require('./logger.cjs')
const { downloadFile, httpGet } = require('./downloader.cjs')

const BEDROCK_DIR = process.env.NAL_BEDROCK_DIR || path.join(process.env.NAL_APP_DIR || '', 'bedrock')
if (!fs.existsSync(BEDROCK_DIR)) fs.mkdirSync(BEDROCK_DIR, { recursive: true })

// 两个官方产品
const PRODUCTS = [
  {
    id: '9NBLGGH2JHXJ',
    channel: '正式版',
    appPattern: /^Microsoft\.MinecraftUWP_/,
    aumid: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App',
    labelKey: 'stable',
  },
  {
    id: '9P5X4QVLC2XR',
    channel: '预览版',
    appPattern: /^Microsoft\.MinecraftWindowsBeta_/,
    aumid: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe!App',
    labelKey: 'preview',
  },
]
// 商店更新通道：先 RP（零售/预览发布环），失败重试 WIF（Insider 快速环）
const RINGS = ['RP', 'WIF']
const RG_API = 'https://store.rg-adguard.net/api/GetFiles'
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://store.rg-adguard.net/',
  'Content-Type': 'application/x-www-form-urlencoded',
}

let _mainWindowGetter = null
let _cache = { at: 0, data: null }
const CACHE_MS = 30 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// minecraft.wiki 被 Cloudflare 挑战拦截时的兜底：
// 用隐藏 BrowserWindow 走真实 Chromium（可执行挑战 JS 拿到通行 cookie），加载 API 页面后读取 JSON 文本
let _wikiWindow = null
async function wikiGetViaBrowser(url) {
  let BrowserWindow
  try { ({ BrowserWindow } = require('electron')) } catch {}
  if (!BrowserWindow) throw new Error('无浏览器环境')
  if (!_wikiWindow || _wikiWindow.isDestroyed()) {
    _wikiWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      userAgent: BROWSER_HEADERS['User-Agent'],
    })
  }
  const wc = _wikiWindow.webContents
  await wc.loadURL(url)
  // 挑战页会自动重载出真实内容；轮询直到拿到 JSON 或超时
  for (let i = 0; i < 12; i++) {
    const text = await wc.executeJavaScript('document.body ? document.body.innerText : ""', true)
    if (text && text.trim().startsWith('{')) return Buffer.from(text, 'utf8')
    await sleep(1000)
  }
  throw new Error('wiki 反爬校验未通过')
}

// wiki API 获取：直连优先，被拦截时走浏览器兜底
async function wikiGet(url) {
  try {
    return await httpGet(url, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }, timeout: 20000 })
  } catch (e) {
    logger.warn('bedrock', 'wiki 直连失败，尝试浏览器通道', { error: e.message })
    const data = await wikiGetViaBrowser(url)
    return { data }
  }
}

// 表单 POST
function formPost(url, body, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString()
    const req = https.request(url, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Length': Buffer.byteLength(data) },
      timeout,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} from store api`))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Store api timeout')))
    req.write(data)
    req.end()
  })
}

// 从商店接口 HTML 解析指定产品的 appx 包
function parsePackages(html, product) {
  const result = []
  const re = /<a href="(http[^"]+)"[^>]*>([^<]+)<\/a>/g
  let m
  while ((m = re.exec(html))) {
    const name = m[2].trim()
    const mm = name.match(/^Microsoft\.(MinecraftUWP|MinecraftWindowsBeta)_([\d.]+)_(x64|x86|arm64|arm)__8wekyb3d8bbwe\.appx$/i)
    if (!mm) continue
    if (!product.appPattern.test(name)) continue
    result.push({
      packageVersion: mm[2], // 商店包版本，如 1.21.11401.0
      arch: mm[3].toLowerCase(),
      channel: product.channel,
      aumid: product.aumid,
      fileName: name,
      url: m[1],
    })
  }
  return result
}

// 获取一个产品的包（多通道重试，通道之间延时避免限流）
async function fetchProduct(product) {
  let lastErr = null
  for (const ring of RINGS) {
    try {
      const html = await formPost(RG_API, { type: 'ProductId', url: product.id, ring, lang: 'en-US' })
      const pkgs = parsePackages(html, product)
      if (pkgs.length) return pkgs
      lastErr = new Error('返回内容中无 Minecraft 包')
    } catch (e) {
      lastErr = e
      logger.warn('bedrock', `商店渠道 ${ring} 获取 ${product.channel} 失败`, { error: e.message })
      await sleep(4000) // 限流保护
    }
  }
  throw lastErr || new Error(`无法获取 ${product.channel} 包列表`)
}

// 版本号分段数值比较（降序）
function verCompareDesc(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d) return d
  }
  return 0
}
const ARCH_RANK = { x64: 0, arm64: 1, x86: 2, arm: 3 }

// 从 minecraft.wiki（官方资料整理）获取真实游戏版本号（苹果商店同款展示）
async function fetchGameVersionLabels() {
  const labels = { stable: '', preview: '' }
  try {
    // 正式版：{{v|bedrock}} → [[Bedrock Edition_26.45|26.45]]
    const tpl = encodeURIComponent('{{v|bedrock}}')
    const { data } = await wikiGet(
      `https://minecraft.wiki/api.php?action=expandtemplates&text=${tpl}&format=json&prop=wikitext`
    )
    const j = JSON.parse(data.toString())
    const m = j?.expandtemplates?.wikitext?.match(/Bedrock Edition_([\d.]+)/)
    if (m) labels.stable = m[1]
  } catch (e) {
    logger.warn('bedrock', 'wiki 正式版版本号获取失败', { error: e.message })
  }
  try {
    // 预览版：开发版本页第一行 Preview 版本号
    const { data } = await wikiGet(
      'https://minecraft.wiki/api.php?action=parse&page=Bedrock%20Edition%20version%20history%2FDevelopment%20versions&prop=wikitext&format=json&section=1'
    )
    const j = JSON.parse(data.toString())
    const text = j?.parse?.wikitext?.['*'] || ''
    const m = text.match(/Preview\s+([\d.]+)/)
    if (m) labels.preview = m[1]
  } catch (e) {
    logger.warn('bedrock', 'wiki 预览版版本号获取失败', { error: e.message })
  }
  return labels
}

// 从 minecraft.wiki 获取完整的基岩版版本历史（数百个版本，实时同步）
// 使用 allpages API 获取所有 "Bedrock Edition X.Y.Z" 页面
async function fetchVersionHistory() {
  const versions = []
  let apcontinue = null

  for (let page = 0; page < 10; page++) {
    let url = 'https://minecraft.wiki/api.php?action=query&list=allpages&apprefix=Bedrock_Edition_&apnamespace=0&aplimit=500&format=json'
    if (apcontinue) url += '&apcontinue=' + encodeURIComponent(apcontinue)
    try {
      const { data } = await wikiGet(url)
      const j = JSON.parse(data.toString())
      const pages = j?.query?.allpages || []
      for (const p of pages) {
        const m = p.title.match(/^Bedrock Edition (\d[\d.]+)$/)
        if (!m) continue
        const ver = m[1]
        // 过滤掉非版本页面，版本号至少 x.y 格式
        if (!/^\d+\.\d+/.test(ver)) continue
        // 排除开发/预览版页面（标题含 Preview/Beta）
        if (/preview|beta/i.test(p.title)) continue
        versions.push(ver)
      }
      apcontinue = j?.continue?.apcontinue
      if (!apcontinue) break
    } catch (e) {
      logger.warn('bedrock', 'wiki 版本历史获取失败（第 ' + (page + 1) + ' 页）', { error: e.message })
      break
    }
  }

  // 去重 + 降序排序
  const unique = [...new Set(versions)]
  unique.sort(verCompareDesc)
  logger.info('bedrock', 'wiki 版本历史获取完成', { count: unique.length })
  return unique
}

// 实时获取基岩版列表（正式版 + 预览版合并 + 完整版本历史）
async function listVersions(force = false) {
  if (!force && _cache.data && Date.now() - _cache.at < CACHE_MS) return _cache.data
  logger.info('bedrock', '获取基岩版版本列表（实时，微软商店官方渠道）')

  // 并行：两个产品的商店包 + wiki 版本号 + 完整版本历史
  const [stableRes, previewRes, labels, history] = await Promise.allSettled([
    fetchProduct(PRODUCTS[0]),
    fetchProduct(PRODUCTS[1]),
    fetchGameVersionLabels(),
    fetchVersionHistory(),
  ])
  const labelsVal = labels.status === 'fulfilled' ? labels.value : { stable: '', preview: '' }
  const historyVal = history.status === 'fulfilled' ? history.value : []

  // 商店包（可下载）
  const storePkgs = []
  const channels = [
    { res: stableRes, gameVersion: labelsVal.stable },
    { res: previewRes, gameVersion: labelsVal.preview },
  ]
  for (const c of channels) {
    if (c.res.status !== 'fulfilled') {
      logger.warn('bedrock', '渠道获取失败', { error: c.res.reason?.message })
      continue
    }
    for (const p of c.res.value) {
      p.gameVersion = c.gameVersion || p.packageVersion
      p.downloadable = true
      storePkgs.push(p)
    }
  }

  // 合并：商店包 + 历史版本（已归档）
  const all = []
  const storeGameVersions = new Set(storePkgs.map((p) => p.gameVersion))
  // 商店包优先
  for (const p of storePkgs) all.push(p)
  // 历史版本（不可下载）
  for (const ver of historyVal) {
    if (storeGameVersions.has(ver)) continue
    all.push({
      gameVersion: ver,
      packageVersion: '',
      arch: 'x64',
      channel: '正式版',
      fileName: '',
      url: '',
      downloadable: false,
      archived: true,
    })
  }

  if (all.length === 0) throw new Error('无法获取基岩版列表（微软商店和 wiki 接口可能暂时繁忙，请稍后重试）')

  // 排序：可下载优先、正式版优先、版本号降序
  all.sort((a, b) => {
    const da = a.downloadable ? 0 : 1
    const db = b.downloadable ? 0 : 1
    if (da !== db) return da - db
    const ca = a.channel === '正式版' ? 0 : 1
    const cb = b.channel === '正式版' ? 0 : 1
    if (ca !== cb) return ca - cb
    return verCompareDesc(a.gameVersion, b.gameVersion) || (ARCH_RANK[a.arch] ?? 9) - (ARCH_RANK[b.arch] ?? 9)
  })

  const data = { versions: all, labels: labelsVal, historyCount: historyVal.length, fetchedAt: Date.now() }
  _cache = { at: Date.now(), data }
  logger.info('bedrock', `基岩版列表完成：${all.length} 个版本（历史 ${historyVal.length} + 商店 ${storePkgs.length}）`, { labels: labelsVal })
  return data
}

// 已下载的安装包（目录名含游戏版本号）
function listDownloaded() {
  const result = []
  if (!fs.existsSync(BEDROCK_DIR)) return result
  for (const dir of fs.readdirSync(BEDROCK_DIR)) {
    const fullDir = path.join(BEDROCK_DIR, dir)
    if (!fs.statSync(fullDir).isDirectory()) continue
    for (const f of fs.readdirSync(fullDir)) {
      if (!f.toLowerCase().endsWith('.appx')) continue
      const mm = f.match(/^Microsoft\.(MinecraftUWP|MinecraftWindowsBeta)_([\d.]+)_(x64|x86|arm64|arm)__8wekyb3d8bbwe\.appx$/i)
      const full = path.join(fullDir, f)
      const isPreview = /MinecraftWindowsBeta/i.test(f)
      result.push({
        fileName: f,
        gameVersion: dir.replace(/^(正式版|预览版)-/, ''),
        packageVersion: mm ? mm[2] : '',
        arch: mm ? mm[3].toLowerCase() : '',
        channel: isPreview ? '预览版' : '正式版',
        aumid: isPreview ? PRODUCTS[1].aumid : PRODUCTS[0].aumid,
        size: fs.statSync(full).size,
        path: full,
        downloadedAt: fs.statSync(full).mtime.toISOString(),
      })
    }
  }
  return result
}

// 下载 appx：目录按「渠道-游戏版本号」命名
async function download(item) {
  const { channel, gameVersion, arch, fileName, url } = item
  const taskId = `bedrock-${gameVersion}-${arch}-${Date.now()}`
  const destDir = path.join(BEDROCK_DIR, `${channel}-${gameVersion}`)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, fileName)
  pushLog(taskId, `开始下载基岩版 ${gameVersion}（${channel} ${arch}）`)
  try {
    await downloadFile(url, destPath, {
      timeout: 300000,
      onProgress: (p) => {
        pushProgress(taskId, {
          phase: `下载 ${fileName}`,
          gameVersion,
          channel,
          arch,
          percent: p.total ? (p.received / p.total) * 100 : 0,
          received: p.received,
          total: p.total,
          speed: p.speed,
        })
      },
    })
    pushLog(taskId, `下载完成：${fileName}`)
    pushProgress(taskId, { phase: '下载完成', gameVersion, channel, arch, percent: 100, done: true })
    logger.info('bedrock', `基岩版 ${gameVersion} ${arch} 下载完成`, { size: fs.statSync(destPath).size })
    return { success: true, taskId, path: destPath }
  } catch (e) {
    logger.error('bedrock', `基岩版下载失败 ${gameVersion}`, { error: e.message })
    pushLog(taskId, `下载失败: ${e.message}`, { error: true })
    pushProgress(taskId, { phase: '下载失败', percent: 100, done: true, error: e.message })
    return { success: false, error: e.message, taskId }
  }
}

function findFile(fileName) {
  if (!fs.existsSync(BEDROCK_DIR)) return null
  for (const verDir of fs.readdirSync(BEDROCK_DIR)) {
    const p = path.join(BEDROCK_DIR, verDir, fileName)
    if (fs.existsSync(p)) return p
  }
  return null
}

// 安装到系统（Add-AppxPackage）
async function installAppx(fileName) {
  const fullPath = findFile(fileName)
  if (!fullPath) return { success: false, error: `未找到文件 ${fileName}` }
  pushLog('bedrock-install', `正在注册到系统：${fileName}（约需 1-3 分钟）`)
  pushProgress('bedrock-install', { phase: '正在安装到系统...', fileName, percent: 50 })
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', `Add-AppxPackage -Path "${fullPath}"; if ($?) { exit 0 } else { exit 1 }`,
    ], { windowsHide: true, timeout: 10 * 60 * 1000 }, (err, _o, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim().split(/\r?\n/).slice(-3).join(' ')
        pushLog('bedrock-install', `安装失败：${msg}`, { error: true })
        pushProgress('bedrock-install', { phase: '安装失败', fileName, percent: 100, done: true, error: msg })
        return resolve({ success: false, error: msg || 'Add-AppxPackage 执行失败' })
      }
      pushLog('bedrock-install', '安装完成！可在开始菜单找到 Minecraft')
      pushProgress('bedrock-install', { phase: '安装完成', fileName, percent: 100, done: true })
      resolve({ success: true, message: '安装完成' })
    })
  })
}

// 启动：先正式版，未安装则尝试预览版
function launch() {
  const aumids = [PRODUCTS[0].aumid, PRODUCTS[1].aumid]
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= aumids.length) {
        pushLog('bedrock-launch', '启动失败：未检测到已安装的基岩版', { error: true })
        return resolve({ success: false, error: '未安装基岩版，请先下载并安装' })
      }
      execFile('explorer.exe', [`shell:appsFolder\\${aumids[i]}`], { windowsHide: true }, (err) => {
        if (err && err.code !== 1) {
          pushLog('bedrock-launch', `${aumids[i]} 启动失败，尝试下一个...`)
          return tryNext(i + 1)
        }
        pushLog('bedrock-launch', i === 0 ? '已启动 Minecraft 基岩版' : '已启动 Minecraft 预览版')
        resolve({ success: true })
      })
    }
    tryNext(0)
  })
}

async function deleteFile(fileName) {
  const p = findFile(fileName)
  if (p) {
    fs.rmSync(path.dirname(p), { recursive: true, force: true })
    logger.info('bedrock', `已删除 ${fileName}`)
    return true
  }
  return false
}

function pushProgress(taskId, data) {
  data.taskId = taskId
  data.timestamp = Date.now()
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('bedrock:progress', data) } catch {}
  }
}
function pushLog(taskId, msg, extra) {
  const entry = { taskId, message: msg, extra, timestamp: Date.now() }
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('bedrock:log', entry) } catch {}
  }
  logger.info('bedrock', `[${taskId}] ${msg}`, extra)
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('bedrock:list', (_e, force) => listVersions(!!force))
  ipcMain.handle('bedrock:download', (_e, item) => download(item))
  ipcMain.handle('bedrock:downloaded', listDownloaded)
  ipcMain.handle('bedrock:delete', (_e, fileName) => deleteFile(fileName))
  ipcMain.handle('bedrock:install', (_e, fileName) => installAppx(fileName))
  ipcMain.handle('bedrock:launch', launch)
  ipcMain.handle('bedrock:dir', () => BEDROCK_DIR)
}

module.exports = { register, listVersions, download, listDownloaded, installAppx, launch }

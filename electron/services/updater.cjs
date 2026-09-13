// 更新检测服务
// 功能：检查 GitHub Releases 最新版本、获取全部版本更新日志、打开下载页
// 网络策略：api.github.com 在部分网络环境下 DNS 会被污染，
//           先按系统默认 DNS 请求，失败后自动通过直连 IP（SNI 保留域名）回退。
const https = require('https')
const { shell } = require('electron')
const { logger } = require('./logger.cjs')

const REPO = 'nuoagentlauncher/nuo-agent-launcher'
const API_HOST = 'api.github.com'
const FALLBACK_IPS = ['140.82.112.6', '140.82.113.6', '20.205.243.168']
const RELEASES_URL = `https://github.com/${REPO}/releases`

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
        'User-Agent': 'nuo-agent-launcher-updater',
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
        https.get(loc, { headers: { 'User-Agent': 'nuo-agent-launcher-updater' } }, (r2) => {
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
          'User-Agent': 'nuo-agent-launcher-updater',
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

function register(ipcMain) {
  ipcMain.handle('updater:check', (_e, opts) => checkUpdate(opts || {}))
  ipcMain.handle('updater:releases', listReleases)
  ipcMain.handle('updater:open-releases', openReleases)
  ipcMain.handle('updater:open-url', openUrl)
}

module.exports = { register, checkUpdate, listReleases, compareVersions, currentVersion }

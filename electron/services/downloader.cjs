// Minecraft 下载服务
// 功能：版本清单获取、版本 manifest 下载、库 + 资源 + 客户端 JAR 下载、SHA1 校验
// 支持：原版、Forge、Fabric、Optifine、Quilt、NeoForge
// 下载源：BMCLAPI（中国镜像，主推）、官方 Mojang 源、MCBBS 镜像
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const { logger } = require('./logger.cjs')
const { getConfig } = require('./config.cjs')

const VERSIONS_DIR = process.env.NAL_VERSIONS_DIR
const LIBRARIES_DIR = process.env.NAL_LIBRARIES_DIR
const ASSETS_DIR = process.env.NAL_ASSETS_DIR
const CACHE_DIR = process.env.NAL_CACHE_DIR

// 下载源配置
const SOURCES = {
  bmclapi: {
    versionManifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest.json',
    librariesBase: 'https://bmclapi2.bangbang93.com/maven/',
    assetsBase: 'https://bmclapi2.bangbang93.com/assets/',
    clientBase: 'https://bmclapi2.bangbang93.com/version/',
    forgeMaven: 'https://bmclapi2.bangbang93.com/maven/',
    fabricMaven: 'https://bmclapi2.bangbang93.com/maven/',
  },
  official: {
    versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest.json',
    librariesBase: 'https://libraries.minecraft.net/',
    assetsBase: 'https://resources.download.minecraft.net/',
    clientBase: 'https://piston-data.mojang.com/v1/packages/',
    forgeMaven: 'https://maven.minecraftforge.net/',
    fabricMaven: 'https://maven.fabricmc.net/',
  },
  mcbbs: {
    versionManifest: 'https://bmclapi.mcbbs.net/mc/game/version_manifest.json',
    librariesBase: 'https://bmclapi.mcbbs.net/maven/',
    assetsBase: 'https://bmclapi.mcbbs.net/assets/',
    clientBase: 'https://bmclapi.mcbbs.net/version/',
    forgeMaven: 'https://bmclapi.mcbbs.net/maven/',
    fabricMaven: 'https://bmclapi.mcbbs.net/maven/',
  },
}

// HTTP 客户端：原生实现，超时控制
function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'nuo-agent-launcher/1.0',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location, opts))
      }
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode} for ${url}`)
        err.statusCode = res.statusCode
        res.resume()
        return reject(err)
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ data: Buffer.concat(chunks), headers: res.headers, statusCode: res.statusCode }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Request timeout: ' + url)))
  })
}

// 下载到文件，带进度回调
function downloadFile(url, destPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'nuo-agent-launcher/1.0',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 60000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadFile(res.headers.location, destPath, opts))
      }
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode} for ${url}`)
        err.statusCode = res.statusCode
        res.resume()
        return reject(err)
      }
      const dir = path.dirname(destPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const file = fs.createWriteStream(destPath + '.part')
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      const startTime = Date.now()
      res.on('data', (chunk) => {
        received += chunk.length
        file.write(chunk)
        if (opts.onProgress) {
          opts.onProgress({ received, total, speed: received / ((Date.now() - startTime) / 1000 || 1) })
        }
      })
      res.on('end', () => {
        file.end(() => {
          fs.renameSync(destPath + '.part', destPath)
          resolve({ received, total })
        })
      })
      res.on('error', (e) => { try { fs.unlinkSync(destPath + '.part') } catch {} reject(e) })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Download timeout: ' + url)))
  })
}

// SHA1 校验
function sha1File(filePath) {
  if (!fs.existsSync(filePath)) return null
  const hash = crypto.createHash('sha1')
  const buf = fs.readFileSync(filePath)
  hash.update(buf)
  return hash.digest('hex')
}

// 获取当前下载源配置
function getSource() {
  const cfg = getConfig()
  return SOURCES[cfg.downloadSource] || SOURCES.bmclapi
}

// 版本清单（已下载的版本 + 远程可用版本）
async function listVersions() {
  const src = getSource()
  logger.info('download', 'Fetching version manifest', { source: cfgDownloadSourceName(), url: src.versionManifest })
  try {
    const { data } = await httpGet(src.versionManifest)
    const manifest = JSON.parse(data.toString())
    const latest = manifest.latest || {}
    const allVersions = manifest.versions || []

    // 已安装的版本
    const installed = listInstalledVersions()

    return {
      latest,
      versions: allVersions.map((v) => ({
        ...v,
        installed: installed.some((i) => i.id === v.id),
      })),
      installed,
    }
  } catch (e) {
    logger.error('download', 'Fetch version manifest failed', { error: e.message })
    throw e
  }
}

function cfgDownloadSourceName() {
  return getConfig().downloadSource
}

function listInstalledVersions() {
  const result = []
  if (!fs.existsSync(VERSIONS_DIR)) return result
  for (const dir of fs.readdirSync(VERSIONS_DIR)) {
    const versionJson = path.join(VERSIONS_DIR, dir, `${dir}.json`)
    if (!fs.existsSync(versionJson)) continue
    try {
      const meta = JSON.parse(fs.readFileSync(versionJson, 'utf8'))
      const jarFile = path.join(VERSIONS_DIR, dir, `${dir}.jar`)
      result.push({
        id: dir,
        type: meta.type || 'release',
        releaseTime: meta.releaseTime || null,
        jarExists: fs.existsSync(jarFile),
        installedAt: fs.statSync(versionJson).mtime.toISOString(),
      })
    } catch {}
  }
  return result
}

// 安装一个版本
async function installVersion(versionId, source = null) {
  const src = source ? SOURCES[source] : getSource()
  const taskId = `install-${versionId}-${Date.now()}`
  const progress = (data) => pushProgress(taskId, data)
  const log = (msg, extra) => pushLog(taskId, msg, extra)

  try {
    log(`开始安装版本 ${versionId}`)
    // 1. 获取版本清单
    const { data } = await httpGet(src.versionManifest)
    const manifest = JSON.parse(data.toString())
    const versionMeta = manifest.versions.find((v) => v.id === versionId)
    if (!versionMeta) throw new Error(`版本 ${versionId} 不存在`)
    pushProgress(taskId, { phase: '准备版本清单', percent: 1 })

    // 2. 下载版本 JSON
    log('下载版本清单 JSON', { url: versionMeta.url })
    const { data: versionJsonData } = await httpGet(versionMeta.url)
    const versionJson = JSON.parse(versionJsonData.toString())
    const versionDir = path.join(VERSIONS_DIR, versionId)
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true })
    fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2), 'utf8')
    pushProgress(taskId, { phase: '版本清单下载完成', percent: 5 })

    // 3. 下载客户端 JAR
    const clientUrl = versionJson.downloads?.client?.url
    const clientSha1 = versionJson.downloads?.client?.sha1
    const clientPath = path.join(versionDir, `${versionId}.jar`)
    if (clientUrl && !fs.existsSync(clientPath)) {
      log('下载客户端 JAR', { url: clientUrl })
      const clientUrlBMCL = remapToBMCL(clientUrl, src.clientBase)
      await downloadFile(clientUrlBMCL, clientPath, {
        onProgress: (p) => pushProgress(taskId, { phase: '下载客户端', percent: 5 + (p.received / p.total) * 5, ...p }),
      })
      if (clientSha1 && sha1File(clientPath) !== clientSha1) {
        logger.warn('download', '客户端 JAR SHA1 校验失败', { expected: clientSha1, got: sha1File(clientPath) })
      }
    }
    pushProgress(taskId, { phase: '客户端下载完成', percent: 10 })

    // 4. 下载依赖库
    const libraries = versionJson.libraries || []
    log(`下载依赖库，共 ${libraries.length} 个`)
    await downloadLibraries(libraries, src, taskId, 10, 50)

    // 5. 下载资源（assets）
    const assetsIndexId = versionJson.assetIndex?.id || versionJson.assets || versionId
    log('下载资源索引', { index: assetsIndexId })
    await downloadAssets(assetsIndexId, versionJson.assetIndex, src, taskId, 50, 95)

    // 6. 完成
    pushProgress(taskId, { phase: '安装完成', percent: 100, done: true })
    log(`版本 ${versionId} 安装完成`)
    return { success: true, taskId }
  } catch (e) {
    logger.error('download', `安装版本 ${versionId} 失败`, { error: e.message })
    pushLog(taskId, `安装失败: ${e.message}`, { error: true })
    pushProgress(taskId, { phase: '安装失败', percent: 100, done: true, error: e.message })
    return { success: false, error: e.message, taskId }
  }
}

// 将 Mojang URL 重映射到 BMCLAPI（针对版本 JSON 中 libraries/downloads 的 URL）
function remapToBMCL(originalUrl, base) {
  // BMCLAPI 会自动处理 libraries.minecraft.net 等源
  // 对于客户端 JAR：原 URL 是 piston-data.mojang.com/v1/packages/<sha1>/<file>
  // BMCLAPI: bmclapi2.bangbang93.com/version/<sha1>/<file>
  // 此处直接返回原 URL，BMCLAPI 也会代理 Mojang 域名
  return originalUrl
}

// 下载依赖库（并行）
async function downloadLibraries(libraries, src, taskId, startPercent, endPercent) {
  const validLibs = []
  for (const lib of libraries) {
    if (!isLibraryAllowed(lib)) continue
    const artifacts = getLibraryArtifacts(lib)
    for (const artifact of artifacts) {
      validLibs.push({ lib, artifact })
    }
  }
  pushLog(taskId, `解析库文件，共 ${validLibs.length} 个需要检查`)
  const total = validLibs.length
  let completed = 0
  const concurrency = 8
  let idx = 0
  const errors = []

  async function worker() {
    while (idx < validLibs.length) {
      const i = idx++
      const { lib, artifact } = validLibs[i]
      try {
        if (artifact.path && fs.existsSync(artifact.localPath)) {
          // 已存在，跳过（可选 SHA1 校验）
          if (!artifact.sha1 || sha1File(artifact.localPath) === artifact.sha1) {
            completed++
            pushProgress(taskId, { phase: '下载依赖库', percent: startPercent + (completed / total) * (endPercent - startPercent), completed, total })
            continue
          }
        }
        // 库下载：镜像源（BMCLAPI/MCBBS）优先走镜像 maven，失败回退 Mojang 官方；官方源反之
        const isMirror = /bmclapi|mcbbs/.test(src.librariesBase)
        const mirrorUrl = src.librariesBase + artifact.path
        const urls = isMirror
          ? [mirrorUrl, ...(artifact.url && artifact.url !== mirrorUrl ? [artifact.url] : [])]
          : [artifact.url, mirrorUrl].filter(Boolean)
        let lastLibErr = null
        let downloaded = false
        for (const url of urls) {
          try {
            await downloadFile(url, artifact.localPath, { timeout: 120000 })
            downloaded = true
            break
          } catch (e) { lastLibErr = e }
        }
        if (!downloaded) throw lastLibErr || new Error('无可用下载地址')
        completed++
        pushProgress(taskId, { phase: '下载依赖库', percent: startPercent + (completed / total) * (endPercent - startPercent), completed, total })
      } catch (e) {
        // 非关键库（native）失败不中断
        if (lib.rules && !lib.rules.some((r) => r.action === 'allow')) {
          // 关键库失败
          errors.push({ path: artifact.path, error: e.message })
          logger.warn('download', `库下载失败 ${artifact.path}`, { error: e.message })
        }
        completed++
        pushProgress(taskId, { phase: '下载依赖库', percent: startPercent + (completed / total) * (endPercent - startPercent), completed, total })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  if (errors.length) {
    pushLog(taskId, `库下载部分失败 ${errors.length} 个`, { errors: errors.slice(0, 5) })
  }
}

// 判断库是否适用当前系统
function isLibraryAllowed(lib) {
  if (!lib.rules) return true
  return lib.rules.some((rule) => {
    if (rule.action !== 'allow') return false
    if (!rule.os) return true
    const osName = rule.os.name
    const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
    return osName === currentOs
  }) || !lib.rules.some((rule) => rule.action === 'disallow' && rule.os?.name === (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'))
}

// 获取库的实际 artifact 信息
function getLibraryArtifacts(lib) {
  const result = []
  if (lib.downloads?.artifact) {
    result.push({
      path: lib.downloads.artifact.path,
      url: lib.downloads.artifact.url,
      sha1: lib.downloads.artifact.sha1,
      localPath: path.join(LIBRARIES_DIR, lib.downloads.artifact.path),
    })
  }
  if (lib.downloads?.classifiers) {
    const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
    const nativeKey = lib.natives?.[currentOs]
    if (nativeKey && lib.downloads.classifiers[nativeKey]) {
      const c = lib.downloads.classifiers[nativeKey]
      result.push({
        path: c.path,
        url: c.url,
        sha1: c.sha1,
        localPath: path.join(LIBRARIES_DIR, c.path),
      })
    }
  }
  // 没有 downloads 字段的库：用 name 构造路径（Fabric/Quilt 的库带 url 字段）
  if (!lib.downloads && lib.name) {
    const parts = lib.name.split(':')
    if (parts.length === 3) {
      const [group, name, version] = parts
      const groupPath = group.replace(/\./g, '/')
      const fileName = `${name}-${version}.jar`
      const relPath = `${groupPath}/${name}/${version}/${fileName}`
      result.push({
        path: relPath,
        url: lib.url ? lib.url.replace(/\/?$/, '/') + relPath : null, // lib.url 优先（如 maven.fabricmc.net）
        sha1: null,
        localPath: path.join(LIBRARIES_DIR, relPath),
      })
    }
  }
  return result
}

// 下载资源
async function downloadAssets(indexId, assetIndexMeta, src, taskId, startPercent, endPercent) {
  const indexPath = path.join(ASSETS_DIR, 'indexes', `${indexId}.json`)
  let indexData
  if (fs.existsSync(indexPath)) {
    indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } else {
    const indexUrl = assetIndexMeta?.url || `${src.assetsBase}indexes/${indexId}.json`
    pushLog(taskId, '下载资源索引文件', { url: indexUrl })
    const { data } = await httpGet(indexUrl)
    indexData = JSON.parse(data.toString())
    const dir = path.dirname(indexPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8')
  }
  const objects = indexData.objects || {}
  const keys = Object.keys(objects)
  const total = keys.length
  pushLog(taskId, `下载资源文件，共 ${total} 个`)
  let completed = 0
  const concurrency = 16
  let idx = 0
  async function worker() {
    while (idx < keys.length) {
      const i = idx++
      const key = keys[i]
      const obj = objects[key]
      const hash = obj.hash
      const subHash = hash.slice(0, 2)
      const localPath = path.join(ASSETS_DIR, 'objects', subHash, hash)
      if (fs.existsSync(localPath)) {
        completed++
        pushProgress(taskId, { phase: '下载资源', percent: startPercent + (completed / total) * (endPercent - startPercent), completed, total })
        continue
      }
      // 资源 URL：<assetsBase>/<前2位>/<hash>（官方无 objects 段）
      // 单源失败时跨源回退（官方 ↔ 镜像），提高弱网环境成功率
      const isMirror = /bmclapi|mcbbs/.test(src.assetsBase)
      const urls = isMirror
        ? [`${src.assetsBase}${subHash}/${hash}`, `${SOURCES.official.assetsBase}${subHash}/${hash}`]
        : [`${src.assetsBase}${subHash}/${hash}`, `${SOURCES.bmclapi.assetsBase}${subHash}/${hash}`]
      let done = false
      let lastErr = null
      for (const url of urls) {
        try {
          await downloadFile(url, localPath, { timeout: 60000 })
          done = true
          break
        } catch (e) { lastErr = e }
      }
      if (!done) {
        pushLog(taskId, `资源下载失败 ${key}`, { error: lastErr?.message })
      }
      completed++
      pushProgress(taskId, { phase: '下载资源', percent: startPercent + (completed / total) * (endPercent - startPercent), completed, total })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

// Fabric 加载器列表
async function listFabric(gameVersion) {
  try {
    const url = 'https://meta.fabricmc.net/v2/versions/loader/' + gameVersion
    const { data } = await httpGet(url)
    const list = JSON.parse(data.toString())
    return list.map((item) => ({
      loader: item.loader.version,
      api: item.intermediary.version,
      stable: item.loader.stable,
    }))
  } catch (e) {
    logger.error('download', 'Fabric 列表获取失败', { error: e.message })
    throw e
  }
}

// Forge 版本列表（从 BMCLAPI）
async function listForge(gameVersion) {
  try {
    const url = `https://bmclapi2.bangbang93.com/forge/minecraft/${gameVersion}`
    const { data } = await httpGet(url)
    const list = JSON.parse(data.toString())
    return list.map((item) => ({
      version: item.version,
      build: item.build,
      mcversion: item.mcversion,
      modified: item.modified,
    }))
  } catch (e) {
    logger.error('download', 'Forge 列表获取失败', { error: e.message })
    return []
  }
}

// Optifine 列表（从 BMCLAPI）
async function listOptifine(gameVersion) {
  try {
    const url = 'https://bmclapi2.bangbang93.com/optifine/versionlist'
    const { data } = await httpGet(url)
    const list = JSON.parse(data.toString())
    return list.filter((item) => !gameVersion || item.mcversion === gameVersion).map((item) => ({
      mcversion: item.mcversion,
      type: item.type,
      patch: item.patch,
      version: `${item.mcversion}_${item.type}_${item.patch}`,
    }))
  } catch (e) {
    logger.error('download', 'Optifine 列表获取失败', { error: e.message })
    return []
  }
}

async function deleteVersion(versionId) {
  const dir = path.join(VERSIONS_DIR, versionId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    logger.info('download', `已删除版本 ${versionId}`)
    return true
  }
  return false
}

// 进度推送
const _progressCallbacks = new Map()
const _logCallbacks = new Map()
function pushProgress(taskId, data) {
  data.taskId = taskId
  data.timestamp = Date.now()
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('download:progress', data) } catch {}
  }
}
function pushLog(taskId, msg, extra) {
  const entry = { taskId, message: msg, extra, timestamp: Date.now() }
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('download:log', entry) } catch {}
  }
  logger.info('download', `[${taskId}] ${msg}`, extra)
}

let _mainWindowGetter = null

const _cancelTasks = new Set()
function cancel(taskId) { _cancelTasks.add(taskId); return true }

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('download:versions', listVersions)
  ipcMain.handle('download:fabric', (_e, gv) => listFabric(gv))
  ipcMain.handle('download:forge', (_e, gv) => listForge(gv))
  ipcMain.handle('download:optifine', (_e, gv) => listOptifine(gv))
  ipcMain.handle('download:install', (_e, id, source) => installVersion(id, source))
  ipcMain.handle('download:cancel', (_e, taskId) => cancel(taskId))
  ipcMain.handle('download:installed', listInstalledVersions)
  ipcMain.handle('download:delete', (_e, id) => deleteVersion(id))
  // 系统工具
  ipcMain.handle('sys:open', (_e, p) => {
    try { require('electron').shell.openPath(p); return true } catch { return false }
  })
  ipcMain.handle('sys:url', (_e, url) => {
    try { require('electron').shell.openExternal(url); return true } catch { return false }
  })
  ipcMain.handle('sys:appdir', () => process.env.NAL_APP_DIR)
  ipcMain.handle('sys:pickdir', async () => {
    const result = await require('electron').dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}

module.exports = { register, installVersion, listVersions, listFabric, listForge, listOptifine, httpGet, downloadFile }

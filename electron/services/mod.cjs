// 模组服务：Modrinth API（无需 API 密钥）搜索、版本查询、依赖解析、下载安装
// 同时提供 Fabric 版本安装（Fabric Meta API）
const fs = require('fs')
const path = require('path')
const { logger } = require('./logger.cjs')
const { request } = require('./account.cjs')
const { downloadFile, httpGet, installVersion } = require('./downloader.cjs')

const VERSIONS_DIR = process.env.NAL_VERSIONS_DIR
const MODRINTH_API = 'https://api.modrinth.com/v2'
const FABRIC_META = 'https://meta.fabricmc.net/v2'

let _mainWindowGetter = null

// ============ 检测实例的加载器和游戏版本 ============
function detectInstanceInfo(instanceId) {
  const jsonPath = path.join(VERSIONS_DIR, instanceId, `${instanceId}.json`)
  if (!fs.existsSync(jsonPath)) throw new Error(`实例 ${instanceId} 不存在`)
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const mainClass = json.mainClass || ''
  let loader = 'vanilla'
  if (mainClass.includes('fabric') || mainClass.includes('Knot')) loader = 'fabric'
  else if (mainClass.includes('forge') || mainClass.includes('FML')) loader = 'forge'
  else if (mainClass.includes('quilt')) loader = 'quilt'
  else if (mainClass.includes('optifine')) loader = 'optifine'
  const gameVersion = json.inheritsFrom || instanceId
  return { loader, gameVersion }
}

// ============ Modrinth 搜索 ============
async function searchMods({ query = '', loader = '', gameVersion = '', limit = 20, offset = 0, index = 'downloads' } = {}) {
  const facets = [['project_type:mod']]
  if (loader) facets.push([`categories:${loader}`])
  if (gameVersion) facets.push([`versions:${gameVersion}`])
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    index,
    query,
    facets: JSON.stringify(facets),
  })
  const url = `${MODRINTH_API}/search?${params.toString()}`
  const res = await request(url, { headers: { Accept: 'application/json' } })
  if (res.statusCode !== 200) throw new Error(`Modrinth 搜索失败 (HTTP ${res.statusCode})`)
  const data = JSON.parse(res.text)
  return {
    total: data.total_hits,
    hits: (data.hits || []).map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      downloads: h.downloads,
      follows: h.follows,
      iconUrl: h.icon_url || '',
      categories: h.categories || [],
      clientSide: h.client_side,
      serverSide: h.server_side,
      dateModified: h.date_modified,
    })),
  }
}

// ============ 查询模组兼容版本 ============
async function getModVersions(projectId, loader, gameVersion) {
  const params = new URLSearchParams()
  if (loader) params.set('loaders', JSON.stringify([loader]))
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  const url = `${MODRINTH_API}/project/${projectId}/version?${params.toString()}`
  const res = await request(url, { headers: { Accept: 'application/json' } })
  if (res.statusCode !== 200) throw new Error(`获取模组版本失败 (HTTP ${res.statusCode})`)
  const list = JSON.parse(res.text)
  return list.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    changelog: v.changelog ? String(v.changelog).slice(0, 800) : '',
    loaders: v.loaders || [],
    gameVersions: v.game_versions || [],
    datePublished: v.date_published,
    downloads: v.downloads,
    dependencies: (v.dependencies || []).map((d) => ({
      projectId: d.project_id,
      type: d.dependency_type, // required / optional / embedded
    })),
    file: (v.files || []).find((f) => f.primary) || (v.files || [])[0] || null,
  }))
}

// ============ 安装模组（含必需依赖递归下载） ============
async function installMod({ projectId, instanceId, versionId = null }) {
  const info = detectInstanceInfo(instanceId)
  if (info.loader === 'vanilla') {
    throw new Error('原版实例不支持模组，请先安装 Fabric（推荐）或 Forge')
  }
  const modsDir = path.join(VERSIONS_DIR, instanceId, 'mods')
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

  const installed = []
  const failed = []
  const visited = new Set()

  async function downloadVersion(pid, depth) {
    if (visited.has(pid) || depth > 5) return
    visited.add(pid)
    const versions = await getModVersions(pid, info.loader, info.gameVersion)
    let target = versionId ? versions.find((v) => v.id === versionId) : versions[0]
    if (!target || !target.file) {
      failed.push({ projectId: pid, reason: '没有兼容此版本/加载器的文件' })
      return
    }
    const fileUrl = target.file.url
    const fileName = target.file.filename
    const dest = path.join(modsDir, fileName)
    if (fs.existsSync(dest)) {
      installed.push({ projectId: pid, fileName, skipped: true })
    } else {
      pushProgress({ phase: `下载 ${fileName}`, current: installed.length + 1, file: fileName })
      await downloadFile(fileUrl, dest, { timeout: 120000 })
      installed.push({ projectId: pid, fileName, skipped: false })
      logger.info('download', `模组下载完成: ${fileName}`)
    }
    // 递归下载必需依赖
    for (const dep of target.dependencies || []) {
      if (dep.type === 'required' && dep.projectId) {
        await downloadVersion(dep.projectId, depth + 1)
      }
    }
  }

  try {
    await downloadVersion(projectId, 0)
  } catch (e) {
    logger.error('download', '模组安装失败', { error: e.message })
    return { success: false, error: e.message, installed, failed }
  }
  return { success: failed.length === 0, installed, failed, modsDir }
}

function listInstalledMods(instanceId) {
  const modsDir = path.join(VERSIONS_DIR, instanceId, 'mods')
  if (!fs.existsSync(modsDir)) return []
  return fs.readdirSync(modsDir)
    .filter((f) => f.endsWith('.jar'))
    .map((f) => {
      const st = fs.statSync(path.join(modsDir, f))
      return { filename: f, size: st.size, modifiedAt: st.mtime.toISOString() }
    })
}

function deleteMod(instanceId, filename) {
  const file = path.join(VERSIONS_DIR, instanceId, 'mods', filename)
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    return true
  }
  return false
}

// ============ Fabric 版本安装 ============
async function installFabric(gameVersion, loaderVersion) {
  const taskId = `fabric-${gameVersion}-${loaderVersion}-${Date.now()}`
  const instanceId = `fabric-${loaderVersion}-${gameVersion}`
  const versionDir = path.join(VERSIONS_DIR, instanceId)
  const log = (msg, extra) => pushLog(msg, extra)
  const progress = (phase, percent) => pushProgress(taskId, { phase, percent })

  try {
    // 1. 确保原版已安装
    const vanillaJson = path.join(VERSIONS_DIR, gameVersion, `${gameVersion}.json`)
    if (!fs.existsSync(vanillaJson)) {
      log(`原版 ${gameVersion} 未安装，先安装原版...`)
      progress('安装原版依赖', 2)
      const r = await installVersion(gameVersion)
      if (!r.success) throw new Error(`原版 ${gameVersion} 安装失败: ${r.error}`)
    }
    progress('获取 Fabric Profile', 15)
    log(`获取 Fabric ${loaderVersion} for ${gameVersion}`)

    // 2. 拉取 Fabric profile json
    const profileUrl = `${FABRIC_META}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`
    const res = await request(profileUrl, { headers: { Accept: 'application/json' } })
    if (res.statusCode !== 200) throw new Error(`Fabric Meta 请求失败 (HTTP ${res.statusCode})`)
    const profile = JSON.parse(res.text)
    // profile: { id, inheritsFrom, releaseTime, mainClass, libraries: [{name, url}] }
    if (!profile.inheritsFrom) profile.inheritsFrom = gameVersion
    if (!profile.id) profile.id = instanceId

    // 3. 写版本 json
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true })
    fs.writeFileSync(path.join(versionDir, `${profile.id}.json`), JSON.stringify(profile, null, 2), 'utf8')
    progress('下载 Fabric 库', 30)

    // 4. 下载 libraries（fabric 库带 url 字段，指向 maven.fabricmc.net）
    const { LIBRARIES_DIR } = {
      LIBRARIES_DIR: process.env.NAL_LIBRARIES_DIR,
    }
    const libs = profile.libraries || []
    let done = 0
    for (const lib of libs) {
      if (!lib.name) { done++; continue }
      const parts = lib.name.split(':')
      if (parts.length !== 3) { done++; continue }
      const [group, artifact, version] = parts
      const relPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`
      const localPath = path.join(LIBRARIES_DIR, relPath)
      if (!fs.existsSync(localPath)) {
        const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/?$/, '/')
        const url = base + relPath
        try {
          await downloadFile(url, localPath, { timeout: 60000 })
        } catch (e) {
          log(`库下载失败 ${lib.name}: ${e.message}`, { error: true })
        }
      }
      done++
      progress(`下载 Fabric 库 ${done}/${libs.length}`, 30 + (done / libs.length) * 40)
    }
    log(`Fabric 库下载完成 (${libs.length} 个)`)

    // 5. 拷贝/复用原版 jar（fabric profile 无自己的 jar，启动时用 inheritsFrom 的 jar）
    progress('完成', 100)
    log(`Fabric 实例 ${profile.id} 安装完成，可在主页选择它并安装模组`)
    return { success: true, instanceId: profile.id }
  } catch (e) {
    logger.error('download', 'Fabric 安装失败', { error: e.message })
    pushLog(`Fabric 安装失败: ${e.message}`, { error: true })
    pushProgress(taskId, { phase: '安装失败', percent: 100, error: e.message })
    return { success: false, error: e.message }
  }
}

function pushProgress(taskId, data) {
  if (typeof data !== 'object' || data === null) data = { phase: taskId, percent: data }
  if (taskId && typeof taskId === 'string') data.taskId = taskId
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('mods:progress', data) } catch {}
  }
}
function pushLog(msg, extra) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('download:log', { message: msg, extra, timestamp: Date.now() }) } catch {}
  }
  logger.info('download', msg, extra)
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('mods:search', (_e, opts) => searchMods(opts || {}))
  ipcMain.handle('mods:versions', (_e, pid, loader, gv) => getModVersions(pid, loader, gv))
  ipcMain.handle('mods:install', (_e, opts) => installMod(opts || {}))
  ipcMain.handle('mods:list-installed', (_e, id) => listInstalledMods(id))
  ipcMain.handle('mods:delete', (_e, id, f) => deleteMod(id, f))
  ipcMain.handle('download:install-fabric', (_e, gv, lv) => installFabric(gv, lv))
}

module.exports = { register, searchMods, getModVersions, installMod, installFabric, listInstalledMods, deleteMod, detectInstanceInfo }

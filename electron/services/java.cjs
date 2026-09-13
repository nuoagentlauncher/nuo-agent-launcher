// Java 自动下载与管理服务
// Mojang 官方为不同版本的游戏提供对应 JRE
// 我们按版本自动选择合适的 JRE（8/17/21）并下载到 java 目录
const fs = require('fs')
const path = require('path')
const os = require('os')
const { exec, execFile } = require('child_process')
const { logger } = require('./logger.cjs')
const { downloadFile, httpGet } = require('./downloader.cjs')

const JAVA_DIR = process.env.NAL_JAVA_DIR
let _mainWindowGetter = null

// JRE 下载源：Eclipse Adoptium（Temurin）JRE
// 主源：清华 TUNA 镜像（国内高速）；备源：Adoptium 官方 API
// 注：Mojang 官方 java-runtime 清单（launchermeta/piston-meta products 端点）已失效（404），不再使用
const TUNA_ADOPTIUM_BASE = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium'
const ADOPTIUM_BINARY = (major) =>
  `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk`

// Java 版本到游戏版本的映射（基于 Mojang 官方建议）
// 1.16.5 之前 → JRE 8
// 1.16.5 ~ 1.17 → JRE 8 (但 1.17+ 要求 Java 16+)
// 1.17 ~ 1.20.4 → JRE 17
// 1.20.5+ → JRE 21
function recommendJavaVersion(gameVersionId) {
  const m = (gameVersionId || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return 17
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10)
  const patch = parseInt(m[3] || '0', 10)
  if (major > 1 || (major === 1 && minor > 20) || (major === 1 && minor === 20 && patch >= 5)) return 21
  if (major === 1 && minor >= 17) return 17
  return 8
}

// 从版本 JSON 读取官方要求的 Java 大版本（如 26.x 要求 Java 25）
// 读不到（老版本无 javaVersion 字段或 JSON 未下载）时返回 null，由 ID 推断兜底
function getRequiredJavaMajor(gameVersionId) {
  try {
    const jsonPath = path.join(process.env.NAL_VERSIONS_DIR || '', gameVersionId, `${gameVersionId}.json`)
    if (fs.existsSync(jsonPath)) {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      if (json.javaVersion?.majorVersion) return parseInt(json.javaVersion.majorVersion, 10)
    }
  } catch {}
  return null
}

// 检测系统中已有的 Java
function detectSystemJava() {
  return new Promise((resolve) => {
    exec('where java', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve([])
      const paths = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      const results = []
      let pending = paths.length
      if (pending === 0) return resolve([])
      for (const p of paths) {
        execFile(p, ['-version'], { windowsHide: true }, (e, _out, stderr) => {
          const verStr = (stderr || '').split(/\r?\n/)[0] || ''
          const m = verStr.match(/version "([^"]+)"/)
          let javaVersion = null
          if (m) {
            const v = m[1].replace(/^1\./, '')
            javaVersion = parseInt(v.split('.')[0], 10) || parseInt(v, 10)
          }
          results.push({ path: p, version: javaVersion, raw: verStr })
          if (--pending === 0) resolve(results)
        })
      }
    })
  })
}

// 列出已安装的 JRE（在 JAVA_DIR 里）
function listInstalledJre() {
  if (!fs.existsSync(JAVA_DIR)) return []
  const result = []
  for (const dir of fs.readdirSync(JAVA_DIR)) {
    const binDir = path.join(JAVA_DIR, dir, 'bin')
    const exe = path.join(binDir, 'javaw.exe')
    if (fs.existsSync(exe)) {
      result.push({
        id: dir,
        path: binDir,
        exePath: exe,
        version: parseJavaId(dir),
      })
    }
  }
  return result
}

function parseJavaId(id) {
  const m = id.match(/(?:jre|jdk)[-_]?(?:windows-)?x64[-_]?(\d+)/i)
  if (m) return parseInt(m[1], 10)
  const m2 = id.match(/(\d+)/)
  if (m2) return parseInt(m2[1], 10)
  return null
}

// 选择最合适的 Java（已安装 > 系统 > 未安装需下载）
async function pickJavaForVersion(gameVersionId) {
  // 优先用版本 JSON 官方声明的 Java 大版本（26.x → 25），否则按 ID 推断
  const target = getRequiredJavaMajor(gameVersionId) || recommendJavaVersion(gameVersionId)
  logger.info('java', `为版本 ${gameVersionId} 推荐 Java ${target}`)

  // 1. 已安装的 JRE
  const installed = listInstalledJre()
  const matchInstalled = installed.find((j) => j.version === target)
  if (matchInstalled) {
    logger.info('java', `命中已安装的 JRE`, { version: target, path: matchInstalled.exePath })
    return { needDownload: false, exePath: matchInstalled.exePath, version: target, source: 'installed' }
  }

  // 2. 系统已装 Java
  const system = await detectSystemJava()
  const matchSystem = system.find((j) => j.version === target)
  if (matchSystem) {
    logger.info('java', `命中系统 Java`, { version: target, path: matchSystem.path })
    return { needDownload: false, exePath: matchSystem.path, version: target, source: 'system' }
  }

  // 3. 需要下载
  logger.info('java', `系统无 Java ${target}，将自动下载`)
  return { needDownload: true, version: target }
}

// 安装 JRE：从 TUNA 镜像 / Adoptium 官方下载对应版本的 Temurin JRE
async function installJre(targetVersion) {
  const taskId = `jre-${targetVersion}-${Date.now()}`
  pushLog(taskId, `开始下载 JRE ${targetVersion}`)
  pushProgress(taskId, { phase: '获取下载地址', percent: 3 })

  const installDir = path.join(JAVA_DIR, `jre-${targetVersion}-windows-x64`)
  if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true })
  const zipPath = path.join(installDir, 'jre.zip')

  // 1. 组装候选下载地址（TUNA 镜像优先，官方 API 兜底）
  const candidates = []
  try {
    const listingUrl = `${TUNA_ADOPTIUM_BASE}/${targetVersion}/jre/x64/windows/`
    const { data } = await httpGet(listingUrl, { timeout: 20000 })
    const names = [...new Set(
      data.toString().match(new RegExp(`OpenJDK${targetVersion}U-jre_x64_windows_hotspot_[\\w.+]+\\.zip`, 'g')) || []
    )]
    if (names.length) {
      // 按版本号取最新（分段数值比较）
      names.sort((a, b) => {
        const pa = a.match(/hotspot_([\d._]+)\.zip/)[1].split(/[._]/).map(Number)
        const pb = b.match(/hotspot_([\d._]+)\.zip/)[1].split(/[._]/).map(Number)
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const d = (pb[i] || 0) - (pa[i] || 0)
          if (d) return d
        }
        return 0
      })
      candidates.push({ url: listingUrl + names[0], name: 'TUNA 镜像' })
    }
  } catch (e) {
    logger.warn('java', 'TUNA 镜像列表获取失败，改用官方源', { error: e.message })
  }
  candidates.push({ url: ADOPTIUM_BINARY(targetVersion), name: 'Adoptium 官方' })

  // 2. 依次尝试下载
  let usedSource = null
  let lastErr = null
  for (const cand of candidates) {
    try {
      pushLog(taskId, `尝试从 ${cand.name} 下载`, { url: cand.url })
      pushProgress(taskId, { phase: `下载 JRE 压缩包（${cand.name}）`, percent: 8 })
      await downloadFile(cand.url, zipPath, {
        timeout: 300000,
        onProgress: (p) => {
          const pct = 8 + (p.received / (p.total || 1)) * 62
          pushProgress(taskId, { phase: `下载 JRE 压缩包（${cand.name}）`, percent: pct, ...p })
        },
      })
      usedSource = cand.name
      break
    } catch (e) {
      lastErr = e
      try { fs.unlinkSync(zipPath) } catch {}
      logger.warn('java', `JRE 下载源失败：${cand.name}`, { error: e.message })
    }
  }
  if (!usedSource) throw new Error(`JRE 下载失败（已尝试 ${candidates.length} 个源）：${lastErr?.message || '未知错误'}`)

  // 3. 解压
  pushProgress(taskId, { phase: '解压 JRE', percent: 75 })
  pushLog(taskId, 'JRE 下载完成，解压中...', { source: usedSource })
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(installDir, true)
  try { fs.unlinkSync(zipPath) } catch {}

  // 4. 平铺：Temurin zip 内含单层根目录（如 jdk-17.x+jre），把内容移到 installDir 根
  const entries = fs.readdirSync(installDir)
  if (!fs.existsSync(path.join(installDir, 'bin')) && entries.length === 1) {
    const inner = path.join(installDir, entries[0])
    if (fs.statSync(inner).isDirectory()) {
      for (const child of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, child), path.join(installDir, child))
      }
      fs.rmdirSync(inner)
    }
  }

  // 5. 找到 javaw.exe
  const javaExe = path.join(installDir, 'bin', 'javaw.exe')
  if (!fs.existsSync(javaExe)) throw new Error('解压后未找到 javaw.exe')

  pushProgress(taskId, { phase: '完成', percent: 100, done: true })
  pushLog(taskId, `JRE ${targetVersion} 安装完成`)
  logger.info('java', `JRE ${targetVersion} 安装完成`, { path: javaExe, source: usedSource })
  return { success: true, exePath: javaExe, version: targetVersion, id: `jre-${targetVersion}-windows-x64` }
}

// 一键：选 Java，必要时下载并安装
async function ensureJavaForVersion(gameVersionId) {
  const pick = await pickJavaForVersion(gameVersionId)
  if (!pick.needDownload) {
    return { exePath: pick.exePath, version: pick.version, downloaded: false }
  }
  const result = await installJre(pick.version)
  return { exePath: result.exePath, version: pick.version, downloaded: true }
}

function pushProgress(taskId, data) {
  data.taskId = taskId
  data.timestamp = Date.now()
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('java:progress', data) } catch {}
  }
}
function pushLog(taskId, msg, extra) {
  const entry = { taskId, message: msg, extra, timestamp: Date.now() }
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('java:log', entry) } catch {}
  }
  logger.info('java', `[${taskId}] ${msg}`, extra)
}

function listJre() {
  return listInstalledJre()
}

async function deleteJre(id) {
  const dir = path.join(JAVA_DIR, id)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }
  return false
}

async function installJreEndpoint(jreId) {
  // jreId 形如 "jre-8" / "jre-17" / "jre-21"
  const m = jreId.match(/jre-(\d+)/)
  if (!m) throw new Error('无效的 JRE ID')
  return installJre(parseInt(m[1], 10))
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('java:list', listJre)
  ipcMain.handle('java:detect', detectSystemJava)
  ipcMain.handle('java:install', (_e, id) => installJreEndpoint(id))
  ipcMain.handle('java:delete', (_e, id) => deleteJre(id))
}

module.exports = { register, installJre, listJre, pickJavaForVersion, ensureJavaForVersion, recommendJavaVersion }

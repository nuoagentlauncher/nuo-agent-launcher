// 启动失败诊断服务
// 功能：检测 MC 启动失败的常见原因并给出修复建议，支持一键自动修复
// 检测项：内存分配、显卡/驱动（OpenGL 能力）、版本核心文件、Java 运行时
// AI 崩溃日志分析：复用 ai.cjs 的免费通道，对 latest.log / 崩溃报告做根因分析
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { logger } = require('./logger.cjs')
const { getConfig } = require('./config.cjs')
const javaSvc = require('./java.cjs')
const downloader = require('./downloader.cjs')

const VERSIONS_DIR = process.env.NAL_VERSIONS_DIR
const LIBRARIES_DIR = process.env.NAL_LIBRARIES_DIR
const ASSETS_DIR = process.env.NAL_ASSETS_DIR

// ---------- 显卡检测（Windows）----------
function getGpuInfo() {
  const gpus = []
  try {
    // wmic 取显卡名称与驱动版本（部分 Win11 已废弃 wmic，失败则走 PowerShell）
    const out = execSync('wmic path win32_VideoController get Name,DriverVersion /format:list', { encoding: 'utf8', timeout: 8000, windowsHide: true })
    out.split(/\r?\n\r?\n/).forEach((block) => {
      const name = (block.match(/^Name=(.+)$/m) || [])[1]
      const drv = (block.match(/^DriverVersion=(.+)$/m) || [])[1]
      if (name && !/Microsoft Basic/i.test(name)) gpus.push({ name: name.trim(), driver: (drv || '').trim() })
    })
  } catch {
    try {
      const ps = 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', timeout: 12000, windowsHide: true })
      let arr = JSON.parse(out || '[]'); if (!Array.isArray(arr)) arr = [arr]
      arr.forEach((g) => { if (g.Name && !/Microsoft Basic/i.test(g.Name)) gpus.push({ name: g.Name, driver: g.DriverVersion || '' }) })
    } catch (e) { logger.info('diagnose', '显卡检测失败', { error: e.message }) }
  }
  return gpus
}

// 判断是否为"太老"的显卡：核显/入门独显在 MC 高版本 OpenGL 要求下容易崩
function isLegacyGpu(name) {
  const n = String(name || '').toLowerCase()
  const legacyPatterns = [
    /intel.*(hd graphics|gma|graphics [0-9]{3}\b)/, // Intel HD 老核显
    /intel.*(2000|3000|4000|2500|4400|4600)/,
    /geforce.*(gt ?[0-6]\d\d|gtx ?[0-5]\d\d|210|310|410|510|610|710)/, // 老 N 卡
    /radeon.*(hd ?[3-6]\d\d\d|r5|r7 ?2\d\d)/, // 老 A 卡
    /amd.*(e[12]-|a[46]-)/,
  ]
  return legacyPatterns.some((p) => p.test(n))
}

// ---------- 版本核心文件完整性 ----------
function checkVersionFiles(versionId, versionJson) {
  const missing = []
  // 主 jar（继承版本回退到父版本）
  let jarPath = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`)
  if (!fs.existsSync(jarPath) && versionJson && versionJson.inheritsFrom) {
    jarPath = path.join(VERSIONS_DIR, versionJson.inheritsFrom, `${versionJson.inheritsFrom}.jar`)
  }
  if (!fs.existsSync(jarPath)) missing.push({ type: 'jar', name: `${versionId}.jar`, path: jarPath })
  // 库文件
  const libs = (versionJson && versionJson.libraries) || []
  let libMiss = 0
  for (const lib of libs) {
    const art = lib.downloads?.artifact
    if (!art || !art.path) continue
    if (!fs.existsSync(path.join(LIBRARIES_DIR, art.path))) libMiss++
  }
  if (libMiss > 0) missing.push({ type: 'libraries', name: `${libMiss} 个库文件`, count: libMiss })
  // 资源索引
  const assetsIndex = versionJson?.assetIndex?.id || versionJson?.assets || versionId
  const idxPath = path.join(ASSETS_DIR, 'indexes', `${assetsIndex}.json`)
  if (!fs.existsSync(idxPath)) missing.push({ type: 'assets', name: `资源索引 ${assetsIndex}.json`, path: idxPath })
  return missing
}

// ---------- 主诊断入口 ----------
async function diagnose(versionId) {
  const issues = []
  const cfg = getConfig()

  // 0. 解析版本 JSON
  let versionJson = null
  try {
    const jsonPath = path.join(VERSIONS_DIR, versionId, `${versionId}.json`)
    versionJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch (e) {
    issues.push({ key: 'json', level: 'error', title: '版本清单损坏', desc: `无法读取 ${versionId}.json：${e.message}`, fix: 'reinstall', fixLabel: '重新安装该版本' })
    return { versionId, issues, gpu: getGpuInfo() }
  }

  // 1. 内存诊断
  const totalMemGB = Math.round(os.totalmem() / 1073741824)
  const allocMB = cfg.javaMemory || 2048
  if (allocMB > totalMemGB * 1024 * 0.6) {
    issues.push({ key: 'memory-high', level: 'warn', title: '内存分配过高', desc: `已分配 ${allocMB}MB，约占物理内存 ${totalMemGB}GB 的 ${Math.round(allocMB / 1024 / totalMemGB * 100)}%。分配过高会导致系统卡顿甚至启动失败。建议 2048-4096MB。`, fix: 'memory-auto', fixLabel: '自动调整为推荐值' })
  } else if (allocMB < 1024) {
    issues.push({ key: 'memory-low', level: 'warn', title: '内存分配过低', desc: `仅分配 ${allocMB}MB，1.17+ 高版本容易因内存不足崩溃。建议至少 2048MB。`, fix: 'memory-auto', fixLabel: '自动调整为推荐值' })
  }

  // 2. 显卡诊断
  const gpus = getGpuInfo()
  const legacy = gpus.filter((g) => isLegacyGpu(g.name))
  if (legacy.length) {
    issues.push({
      key: 'gpu-legacy', level: 'warn', title: '显卡较老，可能不支持新版 OpenGL',
      desc: `检测到 ${legacy.map((g) => g.name).join('、')}。这类显卡运行高版本 MC 容易崩溃或黑屏。可安装优化模组（钠 Sodium / Iris）降低渲染压力，或更新显卡驱动。`,
      fix: 'suggest-mod', fixLabel: '查看推荐优化模组',
    })
  }

  // 3. 核心文件完整性
  const missing = checkVersionFiles(versionId, versionJson)
  if (missing.length) {
    issues.push({
      key: 'files-missing', level: 'error', title: '核心文件缺失',
      desc: `缺少：${missing.map((m) => m.name).join('、')}。多为下载中断或被杀软误删导致。`,
      fix: 'redownload', fixLabel: '一键补齐缺失文件', detail: missing,
    })
  }

  // 4. Java 诊断
  try {
    const pick = await javaSvc.pickJavaForVersion(versionId)
    if (pick.needDownload) {
      issues.push({ key: 'java-missing', level: 'error', title: '缺少匹配的 Java', desc: `该版本需要 Java ${pick.version}，本机未安装。`, fix: 'install-java', fixLabel: `自动下载 Java ${pick.version}`, javaVersion: pick.version })
    }
  } catch (e) {
    issues.push({ key: 'java-check', level: 'warn', title: 'Java 检测异常', desc: e.message, fix: 'install-java', fixLabel: '尝试自动安装 Java', javaVersion: 17 })
  }

  return { versionId, issues, gpu: gpus, totalMemGB, allocMB }
}

// ---------- 一键修复 ----------
async function fix(versionId, fixKey, extra = {}) {
  switch (fixKey) {
    case 'memory-auto': {
      const totalMemGB = Math.round(os.totalmem() / 1073741824)
      const recommend = Math.min(4096, Math.max(2048, Math.floor(totalMemGB * 1024 * 0.4 / 512) * 512))
      const cfg2 = getConfig()
      cfg2.javaMemory = recommend
      require('./config.cjs').saveConfig(cfg2)
      logger.info('diagnose', `内存已调整为 ${recommend}MB`)
      return { success: true, message: `内存已调整为 ${recommend}MB` }
    }
    case 'redownload':
    case 'reinstall': {
      logger.info('diagnose', `补齐/重装版本文件 ${versionId}`)
      const r = await downloader.installVersion(versionId)
      return { success: r.success !== false, message: '核心文件已重新下载补齐' }
    }
    case 'install-java': {
      const v = extra.javaVersion || 17
      logger.info('diagnose', `自动安装 Java ${v}`)
      const r = await javaSvc.installJre(v)
      return { success: !!r.exePath, message: `Java ${v} 安装完成` }
    }
    case 'suggest-mod':
      return { success: true, message: 'SODIUM_IRIS' } // 前端识别后跳模组页
    default:
      return { success: false, message: '未知修复项' }
  }
}

// ---------- AI 崩溃日志分析 ----------
function findCrashLog(versionId) {
  const candidates = []
  const gameDir = path.join(VERSIONS_DIR, versionId)
  const spots = [
    path.join(gameDir, 'logs', 'latest.log'),
    path.join(gameDir, 'crash-reports'),
  ]
  if (fs.existsSync(spots[0])) candidates.push(spots[0])
  // 崩溃报告目录取最新一个 .txt
  if (fs.existsSync(spots[1])) {
    const files = fs.readdirSync(spots[1]).filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, t: fs.statSync(path.join(spots[1], f)).mtimeMs })).sort((a, b) => b.t - a.t)
    if (files.length) candidates.unshift(path.join(spots[1], files[0].f)) // 崩溃报告优先
  }
  return candidates
}

async function analyzeCrash(versionId) {
  const files = findCrashLog(versionId)
  if (!files.length) return { success: false, error: '未找到该版本的运行日志或崩溃报告' }
  // 读最新的一个文件尾部（崩溃报告全文较长，取前 200 行 + 尾 200 行）
  const file = files[0]
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  const excerpt = lines.length > 400
    ? lines.slice(0, 200).join('\n') + '\n...\n' + lines.slice(-200).join('\n')
    : raw
  const ai = require('./ai.cjs')
  const prompt = `你是 Minecraft 启动故障诊断专家。以下是玩家启动 MC ${versionId} 时的日志/崩溃报告（文件：${path.basename(file)}）。请：
1. 用一句话说明失败的根本原因；
2. 判断最可能属于哪一类：内存问题 / 显卡或驱动过老 / Java 版本不对 / 文件缺失或损坏 / 模组冲突 / 其他；
3. 给出 2-3 条具体可操作的修复步骤（中文，简洁）。
日志内容：
${excerpt}`
  const result = await ai.chat([{ role: 'user', content: prompt }], { maxTokens: 1200, temperature: 0.3 })
  return { success: true, file: path.basename(file), analysis: result.text }
}

function register(ipcMain) {
  ipcMain.handle('diagnose:run', (_e, versionId) => diagnose(versionId))
  ipcMain.handle('diagnose:fix', (_e, versionId, fixKey, extra) => fix(versionId, fixKey, extra))
  ipcMain.handle('diagnose:analyze', (_e, versionId) => analyzeCrash(versionId))
}

module.exports = { register, diagnose, fix, analyzeCrash }

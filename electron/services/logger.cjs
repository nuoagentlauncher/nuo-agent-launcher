// 日志服务：统一收集所有子系统的日志，按类别分类
// 类别：launcher / download / java / multiplayer / ai / system
// 同时推送实时日志到前端，持久化到 logs 目录
const fs = require('fs')
const path = require('path')

const LOGS_DIR = process.env.NAL_LOGS_DIR || path.join(process.env.APPDATA || '', 'NuoAgentLauncher', 'logs')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB 单文件
const MAX_RECENT = 2000 // 内存中保留的最近日志条数

const CATEGORIES = ['launcher', 'download', 'java', 'multiplayer', 'ai', 'system', 'account']

// 内存缓存：每个类别最多保留 MAX_RECENT 条
const memoryLogs = {}
CATEGORIES.forEach((c) => (memoryLogs[c] = []))

let _mainWindowGetter = null
let _initialized = false
function init() {
  if (_initialized) return
  _initialized = true
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
}

function getFileStream(category) {
  init()
  const file = path.join(LOGS_DIR, `${category}.log`)
  return { file, append: (line) => {
    try {
      fs.appendFileSync(file, line + '\n', 'utf8')
      const stat = fs.statSync(file)
      if (stat.size > MAX_FILE_SIZE) {
        // 轮转：保留最近 1MB 内容
        const content = fs.readFileSync(file, 'utf8')
        const truncated = content.slice(-Math.floor(MAX_FILE_SIZE / 2))
        fs.writeFileSync(file, truncated, 'utf8')
      }
    } catch (e) { /* ignore file errors */ }
  }}
}

const fileStreams = {}
function getFileStreamCached(category) {
  if (!fileStreams[category]) fileStreams[category] = getFileStream(category)
  return fileStreams[category]
}

function log(category, level, message, extra) {
  init()
  if (!CATEGORIES.includes(category)) category = 'system'
  const entry = {
    ts: Date.now(),
    time: new Date().toISOString(),
    category,
    level, // info / warn / error / debug
    message: typeof message === 'string' ? message : JSON.stringify(message),
    extra: extra || null,
  }
  memoryLogs[category].push(entry)
  if (memoryLogs[category].length > MAX_RECENT) {
    memoryLogs[category].shift()
  }
  // 文件持久化
  const fs2 = getFileStreamCached(category)
  fs2.append(`[${entry.time}] [${level.toUpperCase()}] ${entry.message}`)
  if (extra) fs2.append(`  | extra: ${JSON.stringify(extra)}`)
  // 推送前端
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('logs:new', entry) } catch {}
  }
}

// 公开 API：方便其他服务调用
const logger = {
  info: (cat, msg, extra) => log(cat, 'info', msg, extra),
  warn: (cat, msg, extra) => log(cat, 'warn', msg, extra),
  error: (cat, msg, extra) => log(cat, 'error', msg, extra),
  debug: (cat, msg, extra) => log(cat, 'debug', msg, extra),
  log,
  flush: () => { /* 文件流是同步写，无需 flush */ },
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('logs:categories', () => CATEGORIES)
  ipcMain.handle('logs:recent', (_e, category, limit = 100) => {
    if (!CATEGORIES.includes(category)) return []
    const all = memoryLogs[category] || []
    return all.slice(-limit)
  })
  ipcMain.handle('logs:clear', (_e, category) => {
    if (CATEGORIES.includes(category)) {
      memoryLogs[category] = []
      const fs2 = getFileStreamCached(category)
      try { fs.writeFileSync(fs2.file, '', 'utf8') } catch {}
    }
    return true
  })
  ipcMain.handle('logs:export', (_e, category) => {
    if (!CATEGORIES.includes(category)) return null
    const fs2 = getFileStreamCached(category)
    return fs2.file
  })
}

module.exports = { register, logger, CATEGORIES }

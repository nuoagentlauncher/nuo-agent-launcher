// 配置服务：所有用户设置的统一存储
// 单文件 JSON 持久化，包含游戏路径、Java 内存、下载源、主题、账号活跃 ID 等
const fs = require('fs')
const path = require('path')

const CONFIG_FILE = process.env.NAL_CONFIG_FILE || path.join(process.env.APPDATA || '', 'NuoAgentLauncher', 'config.json')

// 默认配置：首次启动时初始化
const DEFAULT_CONFIG = {
  // 启动器元数据
  version: '1.0.0',
  initialized: false,
  // 主题：dark / light
  theme: 'dark',
  // 游戏根目录：默认在 app 数据目录下的 versions
  gameRoot: process.env.NAL_VERSIONS_DIR || '',
  // 下载源：official (Mojang 官方) / bmclapi / mcbbs
  downloadSource: 'official',
  // Java 设置
  javaMemory: 2048, // MB
  javaExtraArgs: '-XX:+UseG1GC -XX:+UseAdaptiveSizePolicy',
  // 启动设置
  autoSelectJava: true,
  showLogOnLaunch: true,
  // 当前活跃账号 ID
  activeAccountId: null,
  // 联机设置
  lastRoomName: '',
  // 窗口设置
  windowSize: { width: 1180, height: 760 },
  // 自定义主页显示
  showSnapshotVersions: false,
  // 启动器更新通道
  updateChannel: 'stable',
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const dir = path.dirname(CONFIG_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const data = JSON.parse(raw || '{}')
    return { ...DEFAULT_CONFIG, ...data, initialized: true }
  } catch (e) {
    console.error('Load config failed:', e)
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (e) {
    console.error('Save config failed:', e)
  }
}

let _config = null

function getConfig() {
  if (!_config) _config = loadConfig()
  return _config
}

function register(ipcMain) {
  ipcMain.handle('config:getAll', () => getConfig())
  ipcMain.handle('config:get', (_e, key) => getConfig()[key])
  ipcMain.handle('config:set', (_e, key, value) => {
    const cfg = getConfig()
    cfg[key] = value
    _config = cfg
    saveConfig(cfg)
    return cfg
  })
  ipcMain.handle('config:setAll', (_e, data) => {
    _config = { ...getConfig(), ...data }
    saveConfig(_config)
    return _config
  })
}

module.exports = { register, getConfig, saveConfig }

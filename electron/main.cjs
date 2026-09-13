// Electron 主进程
// 负责：窗口创建、IPC 调度、加载所有服务模块、生命周期管理
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'
let mainWindow = null

// 应用数据目录：用户配置、版本、Java、日志都放这里
const APP_DATA_DIR = path.join(app?.getPath?.('userData') || process.env.APPDATA || '', 'NuoAgentLauncher')
const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) }
ensureDir(APP_DATA_DIR)
const VERSIONS_DIR = path.join(APP_DATA_DIR, 'versions')
const ASSETS_DIR = path.join(APP_DATA_DIR, 'assets')
const LIBRARIES_DIR = path.join(APP_DATA_DIR, 'libraries')
const JAVA_DIR = path.join(APP_DATA_DIR, 'java')
const LOGS_DIR = path.join(APP_DATA_DIR, 'logs')
const CACHE_DIR = path.join(APP_DATA_DIR, 'cache')
const BEDROCK_DIR = path.join(APP_DATA_DIR, 'bedrock')
const CONFIG_FILE = path.join(APP_DATA_DIR, 'config.json');
[VERSIONS_DIR, ASSETS_DIR, LIBRARIES_DIR, JAVA_DIR, LOGS_DIR, CACHE_DIR, BEDROCK_DIR].forEach(ensureDir);

// 设置全局环境变量供服务模块使用
process.env.NAL_APP_DIR = APP_DATA_DIR
process.env.NAL_VERSIONS_DIR = VERSIONS_DIR
process.env.NAL_ASSETS_DIR = ASSETS_DIR
process.env.NAL_LIBRARIES_DIR = LIBRARIES_DIR
process.env.NAL_JAVA_DIR = JAVA_DIR
process.env.NAL_LOGS_DIR = LOGS_DIR
process.env.NAL_CACHE_DIR = CACHE_DIR
process.env.NAL_CONFIG_FILE = CONFIG_FILE

// 主窗口创建
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: 'nuo agent launcher',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f1419',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // 允许下载源、皮肤等跨域
    },
  })

  // 移除默认菜单栏
  Menu.setApplicationMenu(null)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // 处理外部链接：用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// 注册服务模块的 IPC 处理器
// 每个服务导出一个 register(ipcMain, mainWindow) 函数，自行注册 invoke / on 监听器
const services = [
  require('./services/config.cjs'),
  require('./services/logger.cjs'),
  require('./services/downloader.cjs'),
  require('./services/java.cjs'),
  require('./services/launcher.cjs'),
  require('./services/account.cjs'),
  require('./services/multiplayer.cjs'),
  require('./services/ai.cjs'),
  require('./services/mod.cjs'),
  require('./services/bedrock.cjs'),
  require('./services/updater.cjs'),
]
services.forEach((svc) => {
  if (svc && typeof svc.register === 'function') {
    try { svc.register(ipcMain, () => mainWindow) } catch (e) { console.error('Service register failed:', e) }
  }
})

// 应用启动
app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 启动 8 秒后静默检查更新（避免与启动抢网络），发现新版通知渲染进程弹提示
  setTimeout(() => {
    try {
      const updater = require('./services/updater.cjs')
      updater.checkUpdate({ silent: true }).then((result) => {
        if (result && result.success && result.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater:available', result)
        }
      }).catch(() => {})
    } catch {}
  }, 8000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 应用退出前的清理
app.on('before-quit', () => {
  try {
    const logger = require('./services/logger.cjs')
    logger.flush?.()
  } catch {}
})

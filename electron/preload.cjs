// Preload 脚本：在隔离上下文里暴露受控的 API 给渲染进程
// 通过 contextBridge 把每个服务的接口暴露成 window.nal.<apiName>
const { contextBridge, ipcRenderer } = require('electron')

// 通用 invoke 包装：捕获异常并序列化
const invoke = async (channel, ...args) => {
  try {
    const res = await ipcRenderer.invoke(channel, ...args)
    return res
  } catch (err) {
    console.error(`IPC invoke ${channel} failed:`, err)
    throw err
  }
}

// 事件订阅：用于进度推送、日志推送等
const onEvent = (channel, callback) => {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('nal', {
  // 配置管理
  config: {
    get: () => invoke('config:get'),
    set: (key, value) => invoke('config:set', key, value),
    getAll: () => invoke('config:getAll'),
    setAll: (data) => invoke('config:setAll', data),
  },
  // 日志
  logs: {
    getCategories: () => invoke('logs:categories'),
    getRecent: (category, limit) => invoke('logs:recent', category, limit),
    clear: (category) => invoke('logs:clear', category),
    exportLogs: (category) => invoke('logs:export', category),
    onNewLog: (cb) => onEvent('logs:new', cb),
  },
  // 下载
  download: {
    listVersions: () => invoke('download:versions'),
    listFabric: (gameVersion) => invoke('download:fabric', gameVersion),
    listForge: (gameVersion) => invoke('download:forge', gameVersion),
    listOptifine: (gameVersion) => invoke('download:optifine', gameVersion),
    installVersion: (versionId, source) => invoke('download:install', versionId, source),
    installFabric: (gameVersion, loaderVersion) => invoke('download:install-fabric', gameVersion, loaderVersion),
    cancel: (taskId) => invoke('download:cancel', taskId),
    listInstalled: () => invoke('download:installed'),
    deleteVersion: (versionId) => invoke('download:delete', versionId),
    onProgress: (cb) => onEvent('download:progress', cb),
    onLog: (cb) => onEvent('download:log', cb),
  },
  // Java
  java: {
    list: () => invoke('java:list'),
    install: (jreId) => invoke('java:install', jreId),
    detect: () => invoke('java:detect'),
    delete: (id) => invoke('java:delete', id),
    onProgress: (cb) => onEvent('java:progress', cb),
    onLog: (cb) => onEvent('java:log', cb),
  },
  // 启动游戏
  launcher: {
    launch: (versionId, accountId, options) => invoke('launcher:launch', versionId, accountId, options),
    onLog: (cb) => onEvent('launcher:log', cb),
    onState: (cb) => onEvent('launcher:state', cb),
    killLast: () => invoke('launcher:kill'),
  },
  // 账号
  account: {
    list: () => invoke('account:list'),
    addOffline: (name) => invoke('account:add-offline', name),
    addMicrosoft: () => invoke('account:add-microsoft'),
    microsoftCheck: (deviceCode) => invoke('account:microsoft-check', deviceCode),
    addYggdrasil: (yggServer, email, password) => invoke('account:add-yggdrasil', yggServer, email, password),
    refresh: (id) => invoke('account:refresh', id),
    remove: (id) => invoke('account:remove', id),
    setActive: (id) => invoke('account:set-active', id),
    getSkin: (id) => invoke('account:skin', id),
  },
  // 模组
  mods: {
    search: (opts) => invoke('mods:search', opts),
    versions: (projectId, loader, gameVersion) => invoke('mods:versions', projectId, loader, gameVersion),
    install: (opts) => invoke('mods:install', opts),
    listInstalled: (instanceId) => invoke('mods:list-installed', instanceId),
    deleteMod: (instanceId, filename) => invoke('mods:delete', instanceId, filename),
    onProgress: (cb) => onEvent('mods:progress', cb),
  },
  // 基岩版（Windows UWP）
  bedrock: {
    list: (force) => invoke('bedrock:list', force),
    download: (item) => invoke('bedrock:download', item),
    listDownloaded: () => invoke('bedrock:downloaded'),
    deleteFile: (fileName) => invoke('bedrock:delete', fileName),
    install: (fileName) => invoke('bedrock:install', fileName),
    launch: () => invoke('bedrock:launch'),
    openDir: () => invoke('bedrock:dir'),
    onProgress: (cb) => onEvent('bedrock:progress', cb),
    onLog: (cb) => onEvent('bedrock:log', cb),
  },
  // 联机
  multiplayer: {
    createRoom: (cfg) => invoke('mp:create', cfg),
    joinRoom: (cfg) => invoke('mp:join', cfg),
    leaveRoom: () => invoke('mp:leave'),
    listLocal: () => invoke('mp:list-local'),
    getState: () => invoke('mp:state'),
    onEvent: (cb) => onEvent('mp:event', cb),
  },
  // AI 助手
  ai: {
    chat: (messages, opts) => invoke('ai:chat', messages, opts),
    cancel: (id) => invoke('ai:cancel', id),
    speedTest: () => invoke('ai:speed-test'),
    onChunk: (cb) => onEvent('ai:chunk', cb),
    onDone: (cb) => onEvent('ai:done', cb),
    onError: (cb) => onEvent('ai:error', cb),
    onStatus: (cb) => onEvent('ai:status', cb),
  },
  // 系统工具
  system: {
    openPath: (p) => invoke('sys:open', p),
    openUrl: (url) => invoke('sys:url', url),
    getAppDir: () => invoke('sys:appdir'),
    pickDirectory: () => invoke('sys:pickdir'),
  },
  // 更新检测（GitHub Releases）
  updater: {
    check: (silent) => invoke('updater:check', { silent: silent !== false }),
    releases: () => invoke('updater:releases'),
    openReleases: () => invoke('updater:open-releases'),
    openUrl: (url) => invoke('updater:open-url', url),
    onUpdateAvailable: (cb) => onEvent('updater:available', cb),
  },
})

// 路径信息
contextBridge.exposeInMainWorld('nalEnv', {
  isDev: process.env.NODE_ENV === 'development',
  platform: process.platform,
  versions: process.versions,
})

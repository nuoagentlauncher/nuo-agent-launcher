// Minecraft 启动服务
// 功能：版本 JSON 解析、library classpath、native 提取、启动参数生成、Java 调用、日志监控
// 支持账号：离线、正版 Microsoft、外置 Yggdrasil
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { logger } = require('./logger.cjs')
const { getConfig } = require('./config.cjs')
const { ensureJavaForVersion } = require('./java.cjs')
const accountSvc = require('./account.cjs')

const VERSIONS_DIR = process.env.NAL_VERSIONS_DIR
const LIBRARIES_DIR = process.env.NAL_LIBRARIES_DIR
const ASSETS_DIR = process.env.NAL_ASSETS_DIR
const NATIVES_DIR = path.join(process.env.NAL_CACHE_DIR, 'natives')

let _mainWindowGetter = null
let _lastProcess = null

// 解析版本 JSON，包含继承的 parent version
async function resolveVersionJson(versionId) {
  const versionDir = path.join(VERSIONS_DIR, versionId)
  const jsonPath = path.join(versionDir, `${versionId}.json`)
  if (!fs.existsSync(jsonPath)) throw new Error(`版本 ${versionId} 的清单文件不存在`)
  let json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  // 如果有父版本（继承版本，如 Forge/Fabric），递归合并
  if (json.inheritsFrom && json.inheritsFrom !== versionId) {
    const parentJson = await resolveVersionJson(json.inheritsFrom)
    // 合并：子版本覆盖父版本
    return {
      ...parentJson,
      ...json,
      libraries: [...(parentJson.libraries || []), ...(json.libraries || [])],
      arguments: {
        game: [...(parentJson.arguments?.game || []), ...(json.arguments?.game || [])],
        jvm: [...(parentJson.arguments?.jvm || []), ...(json.arguments?.jvm || [])],
      },
    }
  }
  return json
}

// 获取本版本对应的 classpath（仅本机适用的库）
function getClasspath(versionJson) {
  const libs = []
  const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  for (const lib of versionJson.libraries || []) {
    if (!isLibraryAllowed(lib, currentOs)) continue
    // 获取 artifact 路径
    if (lib.downloads?.artifact) {
      const p = path.join(LIBRARIES_DIR, lib.downloads.artifact.path)
      if (fs.existsSync(p)) libs.push(p)
    } else if (lib.name) {
      const parts = lib.name.split(':')
      if (parts.length === 3) {
        const relPath = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}.jar`
        const p = path.join(LIBRARIES_DIR, relPath)
        if (fs.existsSync(p)) libs.push(p)
      }
    }
  }
  return libs
}

function isLibraryAllowed(lib, currentOs) {
  if (!lib.rules) return true
  return lib.rules.some((rule) => {
    if (rule.action !== 'allow') return false
    if (!rule.os) return true
    return rule.os.name === currentOs
  }) || !lib.rules.some((rule) => rule.action === 'disallow' && rule.os?.name === currentOs)
}

// 提取 native 库到临时目录
function extractNatives(versionJson, versionId) {
  const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  const nativeDir = path.join(NATIVES_DIR, versionId)
  if (fs.existsSync(nativeDir)) fs.rmSync(nativeDir, { recursive: true, force: true })
  fs.mkdirSync(nativeDir, { recursive: true })
  let AdmZip
  try { AdmZip = require('adm-zip') } catch { AdmZip = null }
  for (const lib of versionJson.libraries || []) {
    if (!isLibraryAllowed(lib, currentOs)) continue
    const nativeKey = lib.natives?.[currentOs]
    if (!nativeKey) continue
    const classifier = lib.downloads?.classifiers?.[nativeKey]
    if (!classifier) continue
    const libPath = path.join(LIBRARIES_DIR, classifier.path)
    if (!fs.existsSync(libPath)) continue
    if (AdmZip) {
      try {
        const zip = new AdmZip(libPath)
        zip.getEntries().forEach((entry) => {
          if (entry.entryName.startsWith('META-INF/')) return
          zip.extractEntryTo(entry.entryName, nativeDir, false, true)
        })
      } catch (e) {
        logger.warn('launcher', `解压 native 失败 ${libPath}`, { error: e.message })
      }
    }
  }
  return nativeDir
}

// 替换参数模板
function applyArgs(args, ctx, features = {}) {
  const result = []
  for (const a of args || []) {
    if (typeof a === 'string') {
      let v = a
      v = v.replace(/\$\{([^}]+)\}/g, (_, name) => ctx[name] || '')
      result.push(v)
    } else if (a && typeof a === 'object') {
      // { value, rules } 形式
      if (isArgRulesMatch(a.rules, features)) {
        const values = Array.isArray(a.value) ? a.value : [a.value]
        for (const v of values) {
          let str = v
          str = str.replace(/\$\{([^}]+)\}/g, (_, name) => ctx[name] || '')
          result.push(str)
        }
      }
    }
  }
  return result
}

function isArgRulesMatch(rules, features = {}) {
  if (!rules || rules.length === 0) return true
  const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  let allow = false
  for (const rule of rules) {
    // features 条件（quickPlay/demo/自定义分辨率等）默认未启用 → 该规则不适用，
    // 否则会把所有 quickPlay 变体全加上，游戏报 "Only one quick play option can be specified"
    if (rule.features && !Object.entries(rule.features).every(([k, v]) => features[k] === v)) continue
    if (rule.os?.name && rule.os.name !== currentOs) continue
    if (rule.action === 'allow') allow = true
    else if (rule.action === 'disallow') allow = false
  }
  return allow
}

// 生成离线 UUID（profile）
function offlineUuid(username) {
  const crypto = require('crypto')
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest()
  // 转为版本 3 UUID
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

// 启动游戏
async function launch(versionId, accountId, options = {}) {
  try {
    logger.info('launcher', `启动游戏 ${versionId}`, { accountId, options })
    pushLog(`开始启动 ${versionId}`)

    // 1. 解析版本
    const versionJson = await resolveVersionJson(versionId)
    pushLog('版本清单解析完成')

    // 2. 获取账号信息
    const accounts = await accountSvc.list()
    const account = accounts.find((a) => a.id === accountId) || accounts.find((a) => a.id === getConfig().activeAccountId)
    if (!account) throw new Error('未选择账号，请先在设置中添加账号')
    pushLog(`使用账号: ${account.name} (${account.type})`)

    // 3. 准备 Java（自动选择或自动下载）
    pushLog('准备 Java 运行时...')
    pushState('preparing-java')
    let javaExe
    if (options.javaExe) {
      javaExe = options.javaExe
      pushLog(`使用指定 Java: ${javaExe}`)
    } else {
      const javaResult = await ensureJavaForVersion(versionId)
      javaExe = javaResult.exePath
      pushLog(`Java 准备完成: ${javaResult.exePath}`)
    }

    // 4. 提取 native
    pushLog('提取 native 库...')
    const nativeDir = extractNatives(versionJson, versionId)

    // 5. 构造 classpath
    const classpath = getClasspath(versionJson)
    // jar 路径：优先本版本目录；Fabric/Forge 继承实例回退到 inheritsFrom 的原版 jar
    let jarPath = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`)
    if (!fs.existsSync(jarPath) && versionJson.inheritsFrom) {
      const parentJar = path.join(VERSIONS_DIR, versionJson.inheritsFrom, `${versionJson.inheritsFrom}.jar`)
      if (fs.existsSync(parentJar)) jarPath = parentJar
    }
    classpath.push(jarPath)
    pushLog(`Classpath 文件数: ${classpath.length}`)

    // 6. 构造上下文
    const gameDir = path.join(VERSIONS_DIR, versionId) // 版本隔离
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true })
    const assetsIndex = versionJson.assetIndex?.id || versionJson.assets || versionId
    const accountInfo = getAccountInfo(account)
    const ctx = {
      auth_player_name: accountInfo.name,
      auth_uuid: accountInfo.uuid,
      auth_access_token: accountInfo.accessToken,
      auth_session: `token:${accountInfo.accessToken}:${accountInfo.uuid}:${accountInfo.name}`,
      auth_xuid: accountInfo.xuid || '',
      clientid: 'nuo-agent-launcher',
      version_name: versionId,
      game_directory: gameDir,
      assets_root: ASSETS_DIR,
      assets_index_name: assetsIndex,
      game_assets: path.join(ASSETS_DIR, 'virtual', assetsIndex),
      user_type: accountInfo.type === 'microsoft' ? 'msa' : accountInfo.type === 'yggdrasil' ? 'legacy' : 'legacy',
      version_type: versionJson.type || 'release',
      natives_directory: nativeDir,
      launcher_name: 'nuo-agent-launcher',
      launcher_version: '1.0.0',
      classpath: classpath.join(process.platform === 'win32' ? ';' : ':'),
      classpath_separator: process.platform === 'win32' ? ';' : ':',
      library_directory: LIBRARIES_DIR,
      classpath_libs: classpath,
      user_properties: '{}',
      // quickPlay / demo / 自定义分辨率占位符（仅当对应 feature 启用时才会出现在参数里）
      resolution_width: options.resolutionWidth || '854',
      resolution_height: options.resolutionHeight || '480',
      quickPlayPath: options.quickPlayPath || '',
      quickPlaySingleplayer: options.quickPlaySingleplayer || '',
      quickPlayMultiplayer: options.quickPlayMultiplayer || '',
      quickPlayRealms: options.quickPlayRealms || '',
    }

    // features：决定版本 JSON 中 features 门控参数是否生效
    const features = {
      has_custom_resolution: !!(options.resolutionWidth && options.resolutionHeight),
      is_demo_user: !!options.demo,
      has_quick_plays_support: !!options.quickPlayPath,
      is_quick_play_singleplayer: !!options.quickPlaySingleplayer,
      is_quick_play_multiplayer: !!options.quickPlayMultiplayer,
      is_quick_play_realms: !!options.quickPlayRealms,
    }

    // 7. JVM 参数
    const cfg = getConfig()
    const memory = options.memory || cfg.javaMemory || 2048
    const maxMem = memory
    const minMem = Math.min(memory, 1024)
    const defaultJvmArgs = [
      `-Xmx${maxMem}M`,
      `-Xms${minMem}M`,
      ...(cfg.javaExtraArgs || '-XX:+UseG1GC -XX:+UseAdaptiveSizePolicy').split(/\s+/).filter(Boolean),
      `-Djava.library.path=${nativeDir}`,
      `-Dminecraft.client.jar=${path.join(VERSIONS_DIR, versionId, `${versionId}.jar`)}`,
    ]
    // 1.13+ 版本 JSON 的 jvm 参数自带 -cp ${classpath}；
    // 不检测会重复传两遍 classpath，命令行超长时 spawn 报 ENAMETOOLONG
    const jsonJvm = versionJson.arguments?.jvm || []
    const jsonHasClasspath = jsonJvm.some(
      (a) => a === '-cp' || (typeof a === 'string' && a.includes('${classpath}')) ||
        (a && typeof a === 'object' && JSON.stringify(a.value || '').includes('${classpath}'))
    )
    if (!jsonHasClasspath) defaultJvmArgs.push('-cp', ctx.classpath)
    const jvmArgs = [...defaultJvmArgs, ...applyArgs(jsonJvm, ctx, features)]

    // 8. 游戏参数（1.13+ 用 arguments.game；1.12- 用 minecraftArguments 字符串）
    let gameArgs = applyArgs(versionJson.arguments?.game || [], ctx, features)
    if (!gameArgs.length && versionJson.minecraftArguments) {
      gameArgs = versionJson.minecraftArguments
        .replace(/\$\{([^}]+)\}/g, (_, name) => ctx[name] ?? '')
        .split(/\s+/)
        .filter(Boolean)
    }

    // 9. 主类
    const mainClass = versionJson.mainClass
    if (!mainClass) throw new Error('版本 mainClass 缺失')

    // 10. 启动
    const allArgs = [...jvmArgs, mainClass, ...gameArgs]
    pushLog('启动 Java 进程', { javaExe, argCount: allArgs.length })
    logger.info('launcher', '启动参数', { javaExe, args: allArgs })

    pushState('launching')
    const cwd = gameDir
    const env = {
      ...process.env,
      APPDATA: path.dirname(VERSIONS_DIR),
      _JAVA_OPTIONS: '-Djava.net.preferIPv4Stack=true',
      PATH: path.dirname(javaExe) + path.delimiter + process.env.PATH,
    }
    const child = spawn(javaExe, allArgs, { cwd, env, windowsHide: true, detached: false })
    _lastProcess = child
    pushState('running')

    child.stdout.on('data', (data) => {
      const text = data.toString().trim()
      if (text) pushLog(text, { stream: 'stdout' })
    })
    child.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) pushLog(text, { stream: 'stderr' })
    })
    child.on('close', (code) => {
      pushLog(`游戏进程退出，代码 ${code}`, { exitCode: code })
      pushState('exited', { exitCode: code })
      logger.info('launcher', `游戏进程退出`, { code })
      _lastProcess = null
    })
    child.on('error', (e) => {
      pushLog(`进程错误: ${e.message}`, { error: true })
      pushState('error', { error: e.message })
      _lastProcess = null
    })

    return { success: true, pid: child.pid }
  } catch (e) {
    logger.error('launcher', '启动失败', { error: e.message })
    pushLog(`启动失败: ${e.message}`, { error: true })
    pushState('error', { error: e.message })
    return { success: false, error: e.message }
  }
}

function getAccountInfo(account) {
  if (account.type === 'offline') {
    return {
      name: account.name,
      uuid: account.uuid || offlineUuid(account.name),
      accessToken: account.accessToken || '0'.repeat(32),
      xuid: '',
      type: 'offline',
    }
  }
  if (account.type === 'microsoft') {
    return {
      name: account.name,
      uuid: account.uuid,
      accessToken: account.accessToken || '0'.repeat(32),
      xuid: account.xuid || '',
      type: 'microsoft',
    }
  }
  if (account.type === 'yggdrasil') {
    return {
      name: account.name,
      uuid: account.uuid,
      accessToken: account.accessToken,
      xuid: '',
      type: 'yggdrasil',
    }
  }
  return { name: account.name, uuid: offlineUuid(account.name), accessToken: '0'.repeat(32), type: 'offline' }
}

function killLast() {
  if (_lastProcess) {
    try { _lastProcess.kill('SIGTERM'); _lastProcess = null; return true } catch { return false }
  }
  return false
}

function pushLog(msg, extra) {
  const entry = { message: msg, extra, timestamp: Date.now() }
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('launcher:log', entry) } catch {}
  }
  logger.info('launcher', msg, extra)
}
function pushState(state, extra) {
  const entry = { state, extra, timestamp: Date.now() }
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('launcher:state', entry) } catch {}
  }
  logger.info('launcher', `状态: ${state}`, extra)
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  ipcMain.handle('launcher:launch', (_e, id, accountId, opts) => launch(id, accountId, opts))
  ipcMain.handle('launcher:kill', killLast)
}

module.exports = { register, launch, resolveVersionJson, getClasspath }

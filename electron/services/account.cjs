// 账号管理服务
// 支持账号类型：offline（离线）、microsoft（正版 Microsoft，完整 XBL→XSTS→Minecraft 链路）、yggdrasil（外置登录 authlib-injector）
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('./logger.cjs')
const { getConfig, saveConfig } = require('./config.cjs')

const ACCOUNTS_FILE = path.join(process.env.NAL_APP_DIR || '', 'accounts.json')
let _accounts = null

// Microsoft OAuth 公共客户端 ID（Minecraft 启动器通用）
const MS_CLIENT_ID = '00000000402b5328'
const MS_DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) || []
    }
  } catch (e) { logger.error('account', '读取账号失败', { error: e.message }) }
  return []
}
function saveAccounts(list) {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), 'utf8') } catch (e) { logger.error('account', '保存账号失败', { error: e.message }) }
}

function list() {
  if (!_accounts) _accounts = loadAccounts()
  return _accounts.map((a) => ({ ...a, accessToken: '***', refreshToken: '***' }))
}

function offlineUuid(username) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

function addOffline(name) {
  if (!_accounts) _accounts = loadAccounts()
  const account = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'offline',
    name,
    uuid: offlineUuid(name),
    accessToken: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  }
  _accounts.push(account)
  saveAccounts(_accounts)
  logger.info('account', '添加离线账号', { name })
  return account
}

// ============ HTTP 工具 ============
function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? require('https') : require('http')
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { 'User-Agent': 'nuo-agent-launcher/1.0', ...headers },
    }
    const req = lib.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        resolve({ statusCode: res.statusCode, text, headers: res.headers })
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout: ' + url)))
    if (body) req.write(body)
    req.end()
  })
}

async function postForm(url, params) {
  const body = new URLSearchParams(params).toString()
  const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  return { status: res.statusCode, data: safeJson(res.text), raw: res.text }
}

async function postJson(url, obj) {
  const body = JSON.stringify(obj)
  const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body })
  return { status: res.statusCode, data: safeJson(res.text), raw: res.text }
}

async function getJson(url, token) {
  const res = await request(url, { headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/json' } })
  return { status: res.statusCode, data: safeJson(res.text), raw: res.text }
}

function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

// ============ Microsoft 正版登录（Device Code Flow 完整链路） ============

// 第一步：获取设备代码，前端展示 user_code 并打开浏览器
async function addMicrosoft() {
  const res = await postForm(MS_DEVICE_URL, {
    client_id: MS_CLIENT_ID,
    scope: 'XboxLive.signin offline_access',
  })
  if (!res.data || res.data.error) {
    throw new Error(res.data?.error_description || '获取设备代码失败')
  }
  logger.info('account', 'Microsoft 登录：已获取设备代码', { userCode: res.data.user_code })
  return {
    userCode: res.data.user_code,
    verificationUri: res.data.verification_uri,
    deviceCode: res.data.device_code,
    expiresIn: res.data.expires_in,
    interval: res.data.interval || 5,
    message: res.data.message,
  }
}

// 第二步：前端轮询此接口，检查用户是否已在浏览器完成登录
// pending 时返回 { pending: true }；完成时走完整认证链并保存账号
async function microsoftCheck(deviceCode) {
  const tokenRes = await postForm(MS_TOKEN_URL, {
    client_id: MS_CLIENT_ID,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
  })
  const td = tokenRes.data
  if (!td) throw new Error('Token 响应解析失败')
  if (td.error === 'authorization_pending') return { pending: true }
  if (td.error === 'slow_down') return { pending: true, slowDown: true }
  if (td.error === 'authorization_declined') return { declined: true, error: '用户拒绝了授权' }
  if (td.error === 'expired_token') return { expired: true, error: '设备代码已过期，请重新登录' }
  if (td.error) return { error: td.error_description || td.error }
  // 用户已授权，拿到 MS access_token / refresh_token
  logger.info('account', 'Microsoft OAuth 授权成功，开始 XBL 认证链')
  const account = await completeMicrosoftAuth(td.access_token, td.refresh_token)
  return { done: true, account: { ...account, accessToken: '***' } }
}

// 完整链路：MS token → XBL → XSTS → Minecraft → profile
async function completeMicrosoftAuth(msAccessToken, msRefreshToken) {
  // 1. Xbox Live 用户认证
  const xbl = await postJson(XBL_URL, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  })
  if (xbl.status !== 200 || !xbl.data?.Token) {
    throw new Error(`XBL 认证失败 (HTTP ${xbl.status})`)
  }
  const userToken = xbl.data.Token
  const uhs = xbl.data.DisplayClaims?.xui?.[0]?.uhs
  logger.info('account', 'XBL 认证成功')

  // 2. XSTS 授权
  const xsts = await postJson(XSTS_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  })
  if (xsts.status !== 200 || !xsts.data?.Token) {
    const xerr = xsts.data?.XErr
    const xerrText = {
      2148916233: '该 Microsoft 账号没有 Xbox 账户，请先在 xbox.com 注册',
      2148916235: 'Xbox Live 在你所在的国家/地区不可用',
      2148916236: '该账号需要完成 Xbox 成人验证',
      2148916237: '该账号需要完成 Xbox 成人验证',
      2148916238: '该账号是儿童账号，无法游玩 Minecraft',
    }[xerr]
    throw new Error(xerrText || `XSTS 授权失败 (HTTP ${xsts.status}, XErr: ${xerr})`)
  }
  const xstsToken = xsts.data.Token
  const xstsUhs = xsts.data.DisplayClaims?.xui?.[0]?.uhs || uhs
  logger.info('account', 'XSTS 授权成功')

  // 3. Minecraft 服务登录
  const mcLogin = await postJson(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${xstsUhs};${xstsToken}`,
  })
  if (mcLogin.status !== 200 || !mcLogin.data?.access_token) {
    throw new Error(`Minecraft 登录失败 (HTTP ${mcLogin.status})`)
  }
  const mcAccessToken = mcLogin.data.access_token
  logger.info('account', 'Minecraft 服务登录成功')

  // 4. 获取玩家档案
  const profile = await getJson(MC_PROFILE_URL, mcAccessToken)
  if (profile.status !== 200 || !profile.data?.id) {
    throw new Error('获取 Minecraft 档案失败：该账号可能未购买 Minecraft Java 版')
  }
  const { id: uuid, name } = profile.data
  logger.info('account', 'Minecraft 档案获取成功', { name, uuid })

  // 5. 保存账号
  const account = {
    id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'microsoft',
    name,
    uuid,
    accessToken: mcAccessToken,
    msRefreshToken: msRefreshToken || null,
    xuid: xstsUhs,
    createdAt: new Date().toISOString(),
  }
  if (!_accounts) _accounts = loadAccounts()
  _accounts.push(account)
  saveAccounts(_accounts)
  return account
}

// 用 refresh_token 刷新 Minecraft 令牌
async function refreshMicrosoft(account) {
  if (!account.msRefreshToken) throw new Error('无 refresh token，请重新登录')
  const res = await postForm(MS_TOKEN_URL, {
    client_id: MS_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: account.msRefreshToken,
    scope: 'XboxLive.signin offline_access',
  })
  if (!res.data?.access_token) throw new Error(res.data?.error_description || '刷新失败')
  // 重新走认证链（会创建新账号条目，这里手动更新旧条目）
  const xbl = await postJson(XBL_URL, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${res.data.access_token}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  })
  if (!xbl.data?.Token) throw new Error('XBL 刷新失败')
  const xsts = await postJson(XSTS_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  })
  if (!xsts.data?.Token) throw new Error('XSTS 刷新失败')
  const uhs = xsts.data.DisplayClaims?.xui?.[0]?.uhs
  const mc = await postJson(MC_LOGIN_URL, { identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}` })
  if (!mc.data?.access_token) throw new Error('Minecraft 令牌刷新失败')

  account.accessToken = mc.data.access_token
  if (res.data.refresh_token) account.msRefreshToken = res.data.refresh_token
  saveAccounts(_accounts)
  logger.info('account', 'Microsoft 令牌已刷新', { name: account.name })
  return account
}

// ============ Yggdrasil 外置登录 ============
async function addYggdrasil(serverUrl, email, password) {
  const payload = JSON.stringify({
    username: email,
    password,
    agent: { name: 'Minecraft', version: 1 },
    requestUser: true,
  })
  const res = await postJson(serverUrl.replace(/\/$/, '') + '/authserver/authenticate', {
    username: email, password, agent: { name: 'Minecraft', version: 1 }, requestUser: true,
  })
  if (res.status !== 200 || res.data?.error) {
    throw new Error(res.data?.errorMessage || `Yggdrasil 登录失败 (HTTP ${res.status})`)
  }
  const account = {
    id: `ygg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'yggdrasil',
    server: serverUrl,
    name: res.data.selectedProfile.name,
    uuid: res.data.selectedProfile.id,
    accessToken: res.data.accessToken,
    createdAt: new Date().toISOString(),
  }
  if (!_accounts) _accounts = loadAccounts()
  _accounts.push(account)
  saveAccounts(_accounts)
  logger.info('account', '添加 Yggdrasil 账号', { name: account.name, server: serverUrl })
  return account
}

async function refresh(id) {
  if (!_accounts) _accounts = loadAccounts()
  const account = _accounts.find((a) => a.id === id)
  if (!account) throw new Error('账号不存在')
  if (account.type === 'microsoft') return refreshMicrosoft(account)
  if (account.type === 'yggdrasil') {
    const res = await postJson(account.server.replace(/\/$/, '') + '/authserver/refresh', {
      accessToken: account.accessToken, requestUser: true,
    })
    if (res.status !== 200 || res.data?.error) throw new Error(res.data?.errorMessage || '刷新失败')
    account.accessToken = res.data.accessToken
    saveAccounts(_accounts)
    return account
  }
  return account
}

function remove(id) {
  if (!_accounts) _accounts = loadAccounts()
  const i = _accounts.findIndex((a) => a.id === id)
  if (i >= 0) {
    _accounts.splice(i, 1)
    saveAccounts(_accounts)
    return true
  }
  return false
}

function setActive(id) {
  const cfg = getConfig()
  cfg.activeAccountId = id
  saveConfig(cfg)
  return true
}

async function getSkin(id) {
  const account = list().find((a) => a.id === id)
  if (!account) return null
  return `https://crafatar.com/avatars/${account.uuid}?size=64&overlay`
}

function register(ipcMain) {
  ipcMain.handle('account:list', list)
  ipcMain.handle('account:add-offline', (_e, name) => addOffline(name))
  ipcMain.handle('account:add-microsoft', addMicrosoft)
  ipcMain.handle('account:microsoft-check', (_e, deviceCode) => microsoftCheck(deviceCode))
  ipcMain.handle('account:add-yggdrasil', (_e, srv, em, pw) => addYggdrasil(srv, em, pw))
  ipcMain.handle('account:refresh', (_e, id) => refresh(id))
  ipcMain.handle('account:remove', (_e, id) => remove(id))
  ipcMain.handle('account:set-active', (_e, id) => setActive(id))
  ipcMain.handle('account:skin', (_e, id) => getSkin(id))
}

module.exports = { register, list, addOffline, addMicrosoft, microsoftCheck, addYggdrasil, refresh, remove, setActive, request, postJson, getJson }

// 联机服务
// 功能：房间创建、加入、密码校验、局域网发现、UPnP 内网穿透（真实 IGD 协议）
// 说明：
//  - 局域网：房主进游戏后 "对局域网开放"，本服务监听 MC 官方多播(224.0.2.60:4445) 自动发现房间
//  - 跨网络：通过 SSDP 发现路由器 IGD，发送 SOAP AddPortMapping 自动映射端口，并返回公网 IP
//  - 房主端在 CONTROL_PORT 跑一个轻量 TCP 控制服务，加入方通过它获取房间信息 / 校验密码
const dgram = require('dgram')
const net = require('net')
const os = require('os')
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { logger } = require('./logger.cjs')

const MULTICAST_ADDR = '224.0.2.60'  // Minecraft 局域网发现地址
const MULTICAST_PORT = 4445          // Minecraft 默认 LAN 端口
const CONTROL_PORT = 44454           // 启动器房间控制端口（信息查询 / 密码校验）
const CONTROL_MAGIC_PORT = 44454     // UPnP 同时映射此端口
const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900

let _mainWindowGetter = null
let _currentRoom = null
let _discoverySocket = null
let _controlServer = null
let _upnp = { descUrl: null, service: null, serviceType: null, externalIp: null, mappings: [] }
let _discoveryStarted = false

// 房间信息持久化文件
const ROOMS_FILE = path.join(process.env.NAL_APP_DIR || '', 'mp-rooms.json')
function loadRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')) || [] } catch { return [] }
}
function saveRooms(list) {
  try { fs.writeFileSync(ROOMS_FILE, JSON.stringify(list, null, 2), 'utf8') } catch {}
}

// 获取本机局域网 IP
function getLocalIp() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function publicRoom(room) {
  if (!room) return null
  const { password, ...safe } = room
  return { ...safe, hasPassword: !!room.password }
}

function pushEvent(data) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('mp:event', data) } catch {}
  }
}

/* ================= 房主端控制服务（TCP JSON 行协议） ================= */
function startControlServer() {
  if (_controlServer) return Promise.resolve(true)
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = ''
      socket.setTimeout(6000)
      socket.on('timeout', () => socket.destroy())
      socket.on('error', () => socket.destroyed || socket.destroy())
      socket.on('data', (chunk) => {
        buf += chunk.toString()
        let msg
        try { msg = JSON.parse(buf.trim()) } catch { return } // 等完整 JSON
        try {
          if (msg.action === 'hello') {
            socket.end(JSON.stringify({ ok: true, room: publicRoom(_currentRoom) }) + '\n')
          } else if (msg.action === 'join') {
            if (!_currentRoom) {
              socket.end(JSON.stringify({ ok: false, error: '房主尚未创建房间' }) + '\n')
              return
            }
            const passOk = !_currentRoom.password || msg.passwordHash === _currentRoom.password
            logger.info('multiplayer', '玩家请求加入', { from: socket.remoteAddress, passOk })
            socket.end(JSON.stringify(passOk
              ? { ok: true, room: publicRoom(_currentRoom) }
              : { ok: false, error: '房间密码错误' }) + '\n')
          } else {
            socket.end(JSON.stringify({ ok: false, error: '未知请求' }) + '\n')
          }
        } catch (e) {
          try { socket.end(JSON.stringify({ ok: false, error: e.message }) + '\n') } catch {}
        }
      })
    })
    server.on('error', (e) => {
      logger.warn('multiplayer', '控制服务启动失败', { error: e.message })
      _controlServer = null
      resolve(false)
    })
    server.listen(CONTROL_PORT, '0.0.0.0', () => {
      _controlServer = server
      logger.info('multiplayer', `房间控制服务已启动 (端口 ${CONTROL_PORT})`)
      resolve(true)
    })
  })
}

function stopControlServer() {
  if (_controlServer) {
    try { _controlServer.close() } catch {}
    _controlServer = null
  }
}

// 加入方向房主控制端口发请求
function controlRequest(host, msg, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: CONTROL_PORT, timeout: timeoutMs })
    let buf = ''
    let done = false
    const finish = (fn, arg) => { if (!done) { done = true; try { socket.destroy() } catch {}; fn(arg) } }
    socket.on('connect', () => socket.write(JSON.stringify(msg) + '\n'))
    socket.on('data', (d) => {
      buf += d.toString()
      const line = buf.split('\n').find((l) => l.trim().startsWith('{'))
      if (line) {
        try { finish(resolve, JSON.parse(line.trim())) } catch (e) { finish(reject, e) }
      }
    })
    socket.on('timeout', () => finish(reject, new Error('连接房主超时')))
    socket.on('error', (e) => finish(reject, e))
  })
}

/* ================= 局域网发现（MC 官方多播协议） ================= */
function startDiscoveryListener() {
  if (_discoveryStarted) return
  _discoveryStarted = true
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (msg, rinfo) => {
    const text = msg.toString().trim()
    // Minecraft LAN 格式: [MOTD]...[/MOTD][AD]...[/AD]
    const motdMatch = text.match(/\[MOTD\]([^\[]*)\[\/MOTD\]/)
    const adMatch = text.match(/\[AD\](\d+)\[\/AD\]/)
    if (motdMatch && adMatch) {
      const port = parseInt(adMatch[1], 10)
      if (!_localRooms.find((r) => r.hostIp === rinfo.address && r.port === port)) {
        const room = {
          name: motdMatch[1],
          hostIp: rinfo.address,
          port,
          version: '未知',
          isHost: false,
          source: 'lan',
        }
        _localRooms.push(room)
        logger.info('multiplayer', '发现局域网房间', { host: rinfo.address, port })
        pushEvent({ type: 'room-discovered', room })
      }
    }
  })
  socket.on('error', (e) => logger.warn('multiplayer', 'UDP 监听错误', { error: e.message }))
  try {
    socket.bind(MULTICAST_PORT, () => {
      try { socket.addMembership(MULTICAST_ADDR) } catch {}
      socket.setBroadcast(true)
      logger.info('multiplayer', `开始监听局域网房间 (${MULTICAST_ADDR}:${MULTICAST_PORT})`)
    })
  } catch (e) {
    logger.warn('multiplayer', '局域网监听绑定失败（端口可能被占用）', { error: e.message })
  }
  _discoverySocket = socket
}

let _localRooms = []

/* ================= UPnP IGD 内网穿透（SSDP + SOAP） ================= */
function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { 'User-Agent': 'nuo-agent-launcher/1.0' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c; if (data.length > 512 * 1024) req.destroy() })
      res.on('end', () => resolve({ status: res.statusCode || 200, body: data }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function soapCall(controlUrl, serviceType, action, args, timeoutMs = 5000) {
  const u = new URL(controlUrl)
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body><u:${action} xmlns:u="${serviceType}">${args}</u:${action}></s:Body></s:Envelope>`
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(body),
        SOAPAction: `"${serviceType}#${action}"`,
        Connection: 'close',
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c; if (data.length > 256 * 1024) req.destroy() })
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// SSDP 发现 IGD 设备描述地址
function ssdpDiscover(timeoutMs = 3500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4' })
    const found = new Set()
    let settled = false
    const done = (val) => {
      if (settled) return
      settled = true
      try { sock.close() } catch {}
      resolve(val)
    }
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n'
    )
    sock.on('message', (data) => {
      const text = data.toString()
      const m = text.match(/LOCATION:\s*(\S+)/i)
      if (m) found.add(m[1].trim())
    })
    sock.on('error', () => done([]))
    sock.bind(0, () => {
      sock.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDR)
      // 再广播两次提高命中率
      setTimeout(() => { try { sock.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDR) } catch {} }, 800)
      setTimeout(() => { try { sock.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDR) } catch {} }, 1600)
    })
    setTimeout(() => done([...found]), timeoutMs)
  })
}

// 从设备描述里找 WANIPConnection / WANPPPConnection 的 controlURL
function findWanService(xml, baseUrl) {
  const services = [...xml.matchAll(/<service>([\s\S]*?)<\/service>/g)].map((m) => m[1])
  const candidates = []
  for (const s of services) {
    const typeM = s.match(/<serviceType>([^<]+)<\/serviceType>/)
    const ctrlM = s.match(/<controlURL>([^<]*)<\/controlURL>/)
    if (!typeM || !ctrlM) continue
    const serviceType = typeM[1].trim()
    if (/WAN(IP|PPP)Connection:\d$/.test(serviceType)) {
      const score = (/WANIPConnection:2/.test(serviceType) ? 3 : /WANIPConnection:1/.test(serviceType) ? 2 : 1)
      candidates.push({ score, serviceType, controlUrl: new URL(ctrlM[1].trim(), baseUrl).href })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0] || null
}

// 完整 UPnP 初始化 + 端口映射
async function tryUpnpPortMap(port) {
  try {
    // 已有网关信息则直接映射；否则走发现流程
    if (!_upnp.service) {
      const locations = await ssdpDiscover()
      if (!locations.length) {
        const note = '未发现 UPnP 路由器（可能是电脑直接拨号/路由器关闭了 UPnP）'
        logger.warn('multiplayer', note)
        pushEvent({ type: 'upnp-status', success: false, note })
        return { success: false, note }
      }
      for (const loc of locations.slice(0, 3)) {
        try {
          const { body } = await httpGet(loc)
          const svc = findWanService(body, loc)
          if (svc) { _upnp.descUrl = loc; _upnp.service = svc.controlUrl; _upnp.serviceType = svc.serviceType; break }
        } catch {}
      }
      if (!_upnp.service) {
        const note = '路由器不支持 IGD 端口映射服务'
        pushEvent({ type: 'upnp-status', success: false, note })
        return { success: false, note }
      }
      // 获取公网 IP
      try {
        const r = await soapCall(_upnp.service, _upnp.serviceType, 'GetExternalIPAddress', '')
        const ipM = r.body.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/)
        if (ipM) _upnp.externalIp = ipM[1]
      } catch {}
    }

    const localIp = getLocalIp()
    const ports = [...new Set([Number(port), CONTROL_MAGIC_PORT])]
    const okPorts = []
    for (const p of ports) {
      const args =
        '<NewRemoteHost></NewRemoteHost>' +
        `<NewExternalPort>${p}</NewExternalPort>` +
        '<NewProtocol>TCP</NewProtocol>' +
        `<NewInternalPort>${p}</NewInternalPort>` +
        `<NewInternalClient>${localIp}</NewInternalClient>` +
        '<NewEnabled>1</NewEnabled>' +
        '<NewPortMappingDescription>nuo-agent-launcher</NewPortMappingDescription>' +
        '<NewLeaseDuration>0</NewLeaseDuration>'
      const r = await soapCall(_upnp.service, _upnp.serviceType, 'AddPortMapping', args)
      if (r.status === 200 && !/<errorCode>/.test(r.body)) {
        _upnp.mappings.push(p)
        okPorts.push(p)
      } else {
        const ec = r.body.match(/<errorCode>(\d+)<\/errorCode>/)
        logger.warn('multiplayer', `端口 ${p} 映射失败`, { code: ec ? ec[1] : r.status })
      }
    }
    const success = okPorts.includes(Number(port))
    const result = {
      success,
      externalIp: _upnp.externalIp,
      externalPort: Number(port),
      mappedPorts: okPorts,
      note: success
        ? `UPnP 映射成功，公网地址 ${_upnp.externalIp || '(未知)'}:${port}`
        : 'UPnP 映射被路由器拒绝（端口可能被占用），可改用同一 WiFi 局域网联机',
    }
    logger.info('multiplayer', 'UPnP 结果', result)
    pushEvent({ type: 'upnp-status', ...result })
    return result
  } catch (e) {
    const note = `UPnP 不可用：${e.message}`
    logger.warn('multiplayer', note)
    pushEvent({ type: 'upnp-status', success: false, note })
    return { success: false, note }
  }
}

// 删除本程序建立的映射
async function removeUpnpMappings() {
  if (!_upnp.service || !_upnp.mappings.length) return
  for (const p of _upnp.mappings.slice()) {
    try {
      const args = '<NewRemoteHost></NewRemoteHost>' +
        `<NewExternalPort>${p}</NewExternalPort>` +
        '<NewProtocol>TCP</NewProtocol>'
      await soapCall(_upnp.service, _upnp.serviceType, 'DeletePortMapping', args)
    } catch {}
  }
  _upnp.mappings = []
}

/* ================= 房间生命周期 ================= */
// 创建房间（房主）
async function createRoom(config) {
  const { name, roomId, password, version, maxPlayers = 8, description = '', port = 25565 } = config
  if (!name) throw new Error('房间名称不能为空')
  if (!version) throw new Error('请选择游戏版本')

  const room = {
    id: roomId || `room-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name,
    password: password ? sha256(password) : null,
    version,
    maxPlayers,
    description,
    hostIp: getLocalIp(),
    port,
    createdAt: new Date().toISOString(),
    isHost: true,
  }
  _currentRoom = room

  const all = loadRooms()
  all.unshift({ ...publicRoom(room), joinedAt: new Date().toISOString() })
  if (all.length > 20) all.length = 20
  saveRooms(all)

  // 启动房主控制服务（供加入方查询/校验）
  await startControlServer()
  // 局域网发现监听
  startDiscoveryListener()
  // UPnP 映射（异步，不阻塞房间创建）
  tryUpnpPortMap(port).catch(() => {})

  logger.info('multiplayer', '创建房间', { name, version, port })
  pushEvent({ type: 'room-created', room: publicRoom(room) })
  return publicRoom(room)
}

// 加入房间（房客）：先向房主控制端口查询，再校验密码
async function joinRoom(config) {
  const { hostIp, password, name } = config
  const port = parseInt(config.port, 10) || 25565
  if (!hostIp) throw new Error('请输入主机 IP 地址')

  let info
  try {
    info = await controlRequest(hostIp, { action: 'hello', name: name || '' })
  } catch (e) {
    throw new Error(`无法连接到房主 ${hostIp}（启动器房间服务未响应）：${e.message}。请确认地址正确、双方启动器都在运行`)
  }
  if (!info || !info.ok || !info.room) {
    throw new Error((info && info.error) || '房主房间信息获取失败')
  }
  const room = info.room

  if (room.hasPassword) {
    if (!password) throw new Error('该房间需要密码，请向房主索取')
    const verify = await controlRequest(hostIp, { action: 'join', passwordHash: sha256(password) })
    if (!verify.ok) throw new Error(verify.error || '密码校验失败')
  }

  // 顺便探测游戏端口是否已开放（房主可能还没在游戏内 Open to LAN，不阻断）
  const gamePortOpen = await testConnect(hostIp, port)

  const joined = {
    id: room.id,
    name: room.name,
    version: room.version,
    hostIp,
    port,
    gamePortOpen,
    isHost: false,
    joinedAt: new Date().toISOString(),
  }
  _currentRoom = joined

  const all = loadRooms()
  const idx = all.findIndex((r) => r.hostIp === hostIp && r.port === port)
  if (idx >= 0) all.splice(idx, 1)
  all.unshift(joined)
  if (all.length > 20) all.length = 20
  saveRooms(all)

  startDiscoveryListener()
  logger.info('multiplayer', '加入房间成功', { hostIp, port, gamePortOpen })
  pushEvent({ type: 'room-joined', room: joined })
  return joined
}

function testConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 })
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
    socket.on('error', () => resolve(false))
  })
}

// 离开房间
async function leaveRoom() {
  if (_currentRoom) {
    logger.info('multiplayer', '离开房间', { name: _currentRoom.name })
    if (_currentRoom.isHost) {
      await removeUpnpMappings()
      stopControlServer()
    }
    _currentRoom = null
    pushEvent({ type: 'room-left' })
  }
  return true
}

function listLocal() {
  return { recent: loadRooms(), discovered: _localRooms, current: publicRoom(_currentRoom) }
}

function getState() {
  return { current: publicRoom(_currentRoom), localIp: getLocalIp() }
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  // 应用启动即监听局域网发现（所有玩家都需要看到 LAN 房间）
  startDiscoveryListener()
  ipcMain.handle('mp:create', (_e, cfg) => createRoom(cfg))
  ipcMain.handle('mp:join', (_e, cfg) => joinRoom(cfg))
  ipcMain.handle('mp:leave', leaveRoom)
  ipcMain.handle('mp:list-local', listLocal)
  ipcMain.handle('mp:state', getState)
}

module.exports = { register, createRoom, joinRoom, leaveRoom, listLocal, getState }

// 联机页面：创建房间、加入房间、版本选择、密码
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfigStore } from '../stores/config.js'
import Icon from '../components/Icon.jsx'

export default function MultiplayerPage() {
  const nav = useNavigate()
  const config = useConfigStore((s) => s.config)
  const [tab, setTab] = useState('create') // create / join / list
  const [versions, setVersions] = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [localIp, setLocalIp] = useState('')
  const [discovered, setDiscovered] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [upnp, setUpnp] = useState(null)

  // 启动游戏（房主/加入共用）：使用当前激活账号
  const launchGame = async (versionId) => {
    const accs = await window.nal.account.list()
    const target = accs.find((a) => a.id === config.activeAccountId) || accs[0]
    if (!target) {
      setError('房间已就绪，但还没有账号，请先到设置页面添加账号后从主页启动游戏')
      return false
    }
    const result = await window.nal.launcher.launch(versionId, target.id, {})
    if (!result.success) {
      setError(result.error || '游戏启动失败')
      return false
    }
    return true
  }

  // 创建房间表单
  const [createForm, setCreateForm] = useState({
    name: config.lastRoomName || '',
    roomId: '',
    password: '',
    version: '',
    maxPlayers: 8,
    description: '',
    port: 25565,
  })

  // 加入房间表单
  const [joinForm, setJoinForm] = useState({
    hostIp: '',
    port: 25565,
    password: '',
    roomId: '',
    name: '',
  })

  const refresh = async () => {
    try {
      const data = await window.nal.download.listInstalled()
      setVersions(data)
      if (data.length > 0 && !createForm.version) {
        setCreateForm((f) => ({ ...f, version: data[0].id }))
      }
      const state = await window.nal.multiplayer.getState()
      setCurrentRoom(state.current)
      setLocalIp(state.localIp)
      const local = await window.nal.multiplayer.listLocal()
      setDiscovered(local.discovered || [])
      setRecent(local.recent || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    refresh()
    const unsub = window.nal.multiplayer.onEvent((data) => {
      if (data.type === 'room-created' || data.type === 'room-joined' || data.type === 'room-left') {
        if (data.type === 'room-left') setUpnp(null)
        refresh()
      } else if (data.type === 'room-discovered') {
        setDiscovered((prev) => [...prev, data.room])
      } else if (data.type === 'upnp-status') {
        const { type, ...status } = data
        setUpnp(status)
      }
    })
    return () => unsub()
  }, [])

  const handleCreate = async () => {
    setError('')
    setSuccess('')
    if (!createForm.version) {
      setError('请先选择游戏版本（未下载版本请先到下载页面安装）')
      return
    }
    if (!createForm.name) {
      setError('房间名称不能为空')
      return
    }
    setLoading(true)
    setUpnp(null)
    try {
      const room = await window.nal.multiplayer.createRoom(createForm)
      useConfigStore.getState().set('lastRoomName', createForm.name)
      setSuccess(`房间「${room.name}」创建成功，房间号：${room.id}。正在启动游戏…进入存档后按 Esc →「对局域网开放」，端口填 ${room.port}，把 IP 和端口告诉好友即可`)
      const ok = await launchGame(createForm.version)
      if (ok) setTimeout(() => nav('/'), 800)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    setError('')
    setSuccess('')
    if (!joinForm.hostIp) {
      setError('请输入主机 IP 地址')
      return
    }
    setLoading(true)
    try {
      const room = await window.nal.multiplayer.joinRoom(joinForm)
      const tip = room.gamePortOpen
        ? '房主游戏端口已开放'
        : '房主可能还没在游戏内开放局域网，可等其开放后再连接'
      setSuccess(`已加入房间「${room.name || ''}」（${tip}）。进入游戏后打开 多人游戏 → 直接连接 → 输入 ${room.hostIp}:${room.port}`)
      // 本地已装相同版本则直接启动游戏
      const installed = await window.nal.download.listInstalled()
      if (room.version && installed.some((v) => v.id === room.version)) {
        const ok = await launchGame(room.version)
        if (ok) setTimeout(() => nav('/'), 800)
      } else if (room.version) {
        setError(`校验通过，但本机未安装版本 ${room.version}，请先到下载页面安装相同版本`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLeave = async () => {
    await window.nal.multiplayer.leaveRoom()
    setSuccess('已离开房间')
    refresh()
  }

  return (
    <div className="scroll-y" style={{ height: '100%', padding: '32px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 className="text-2xl mb-4">联机大厅</h1>

        {currentRoom && (
          <div className="card mb-4" style={{ borderColor: 'var(--success)', background: 'rgba(16,185,129,0.05)' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="badge badge-success">当前房间</span>
                  <strong>{currentRoom.name || '加入的房间'}</strong>
                </div>
                <div className="text-sm text-secondary mt-2">
                  {currentRoom.isHost ? (
                    <>你是房主 · IP <code style={{ fontFamily: 'Consolas' }}>{currentRoom.hostIp || localIp}</code> · 端口 <code style={{ fontFamily: 'Consolas' }}>{currentRoom.port}</code>
                      <br />
                      <span className="text-xs text-tertiary">将上方 IP 和端口告诉其他玩家，他们就可以加入你的房间</span>
                    </>
                  ) : (
                    <>已连接到主机 <code style={{ fontFamily: 'Consolas' }}>{currentRoom.hostIp}:{currentRoom.port}</code></>
                  )}
                </div>
                {currentRoom.version && <div className="text-xs text-tertiary mt-2">版本：{currentRoom.version}</div>}
                {currentRoom.isHost && upnp && (
                  <div className="text-xs mt-2" style={{ color: upnp.success ? 'var(--success)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {upnp.success
                      ? <><Icon name="globe" size={13} /> UPnP 穿透已开启：公网地址 <code style={{ fontFamily: 'Consolas' }}>{upnp.externalIp}:{upnp.externalPort}</code>，异地好友可直连此地址</>
                      : <><Icon name="globe" size={13} /> UPnP 穿透未生效：{upnp.note}（同一 WiFi/局域网联机不受影响）</>}
                  </div>
                )}
              </div>
              <button className="btn btn-danger btn-sm" onClick={handleLeave}>离开</button>
            </div>
          </div>
        )}

        {error && (
          <div className="card mb-4" style={{ borderColor: 'var(--error)', background: 'rgba(239,68,68,0.08)' }}>
            <div className="text-sm" style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={15} /> {error}</div>
          </div>
        )}
        {success && (
          <div className="card mb-4" style={{ borderColor: 'var(--success)', background: 'rgba(16,185,129,0.08)' }}>
            <div className="text-sm" style={{ color: 'var(--success)', display: 'flex', alignItems: 'flex-start', gap: 6 }}><Icon name="check" size={15} style={{ marginTop: 2 }} /> <span>{success}</span></div>
          </div>
        )}

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-4">
          <button className={`btn btn-sm ${tab === 'create' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('create')}>创建房间</button>
          <button className={`btn btn-sm ${tab === 'join' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('join')}>加入房间</button>
          <button className={`btn btn-sm ${tab === 'list' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('list')}>已发现房间</button>
        </div>

        {tab === 'create' && (
          <div className="card">
            <h2 className="text-lg mb-4" style={{ fontWeight: 600 }}>创建房间</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="field-label">房间名称 *</label>
                <input className="input" placeholder="例如：快乐联机" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </div>
              <div>
                <label className="field-label">房间号 / 房间代码</label>
                <input className="input" placeholder="留空自动生成" value={createForm.roomId} onChange={(e) => setCreateForm({ ...createForm, roomId: e.target.value })} />
              </div>
              <div>
                <label className="field-label">房间密码</label>
                <input className="input" type="password" placeholder="（可选）" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              </div>
              <div>
                <label className="field-label">最大玩家数</label>
                <input className="input" type="number" min="1" max="100" value={createForm.maxPlayers} onChange={(e) => setCreateForm({ ...createForm, maxPlayers: parseInt(e.target.value, 10) || 8 })} />
              </div>
              <div>
                <label className="field-label">游戏版本 *</label>
                <select className="select" value={createForm.version} onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })}>
                  {versions.length === 0 && <option value="">未安装任何版本</option>}
                  {versions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                </select>
                {versions.length === 0 && (
                  <div className="text-xs text-tertiary mt-2">
                    <a href="#/download" onClick={(e) => { e.preventDefault(); nav('/download') }}>前往下载版本 →</a>
                  </div>
                )}
              </div>
              <div>
                <label className="field-label">游戏端口</label>
                <input className="input" type="number" value={createForm.port} onChange={(e) => setCreateForm({ ...createForm, port: parseInt(e.target.value, 10) || 25565 })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label">房间描述</label>
                <textarea className="textarea" rows="2" placeholder="（可选）房间简介" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>创建并启动游戏</button>
              <span className="text-xs text-tertiary" style={{ alignSelf: 'center' }}>
                · 房间创建后将开始监听局域网发现，房主可在游戏内 "Open to LAN" 让其他玩家加入
              </span>
            </div>
          </div>
        )}

        {tab === 'join' && (
          <div className="card">
            <h2 className="text-lg mb-4" style={{ fontWeight: 600 }}>加入房间</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="field-label">主机 IP 地址 *</label>
                <input className="input" placeholder="例如：192.168.1.100" value={joinForm.hostIp} onChange={(e) => setJoinForm({ ...joinForm, hostIp: e.target.value })} />
              </div>
              <div>
                <label className="field-label">端口</label>
                <input className="input" type="number" value={joinForm.port} onChange={(e) => setJoinForm({ ...joinForm, port: parseInt(e.target.value, 10) || 25565 })} />
              </div>
              <div>
                <label className="field-label">房间号</label>
                <input className="input" placeholder="（可选）房主提供的房间号" value={joinForm.roomId} onChange={(e) => setJoinForm({ ...joinForm, roomId: e.target.value })} />
              </div>
              <div>
                <label className="field-label">房间密码</label>
                <input className="input" type="password" placeholder="（如有）" value={joinForm.password} onChange={(e) => setJoinForm({ ...joinForm, password: e.target.value })} />
              </div>
            </div>
            <div className="mt-4">
              <button className="btn btn-primary" onClick={handleJoin} disabled={loading}>加入房间</button>
              <span className="text-xs text-tertiary" style={{ marginLeft: 12 }}>· 需要在房主启动游戏后才能连接</span>
            </div>
          </div>
        )}

        {tab === 'list' && (
          <div className="card">
            <h2 className="text-lg mb-2" style={{ fontWeight: 600 }}>已发现房间</h2>
            <p className="text-xs text-tertiary mb-4">局域网内其他玩家启动游戏并 "Open to LAN" 后会自动出现在这里</p>
            <div className="mb-4">
              <div className="text-sm text-secondary mb-2">最近创建的房间</div>
              {recent.length === 0 ? <div className="text-tertiary text-sm">暂无</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {recent.map((r, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{r.name}</strong>
                        <span className="badge ml-2">{r.version}</span>
                        {r.hasPassword && <span className="badge badge-warning ml-2" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="lock" size={12} /> 密码</span>}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => setJoinForm({ ...joinForm, hostIp: r.hostIp, port: r.port }) || setTab('join')}>填入并加入</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-sm text-secondary mb-2">局域网发现的房间</div>
              {discovered.length === 0 ? <div className="text-tertiary text-sm">暂未发现局域网房间</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {discovered.map((r, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{r.name}</strong>
                        <span className="text-xs text-tertiary ml-2">{r.hostIp}:{r.port}</span>
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => setJoinForm({ ...joinForm, hostIp: r.hostIp, port: r.port }) || setTab('join')}>加入</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 提示 */}
        <div className="card mt-4" style={{ background: 'rgba(79,158,255,0.05)' }}>
          <h3 className="text-sm" style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="pin" size={15} /> 联机使用说明</h3>
          <ul className="text-xs text-secondary" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            <li>房主：选择已下载版本 → 创建房间 → 启动游戏 → 游戏内按 Esc 选 "Open to LAN" → 设置端口</li>
            <li>玩家：在加入页面填入房主的 IP 和端口即可加入</li>
            <li>跨网络联机需要房主路由器支持 UPnP 或手动配置端口转发</li>
            <li>所有玩家必须使用相同的 Minecraft 版本和模组</li>
            <li>联机时仍需遵守 Minecraft 的版权协议（正版账号登录可避免部分限制）</li>
          </ul>
        </div>
      </div>
      <style>{`
        .field-label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .ml-2 { margin-left: 8px; }
      `}</style>
    </div>
  )
}

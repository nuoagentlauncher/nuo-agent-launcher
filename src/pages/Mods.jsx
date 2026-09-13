// 模组页面：Modrinth 搜索 / 筛选 / 安装到实例 / 已装模组管理 / Fabric 安装
import { useEffect, useState, useRef, useCallback } from 'react'
import { useConfigStore } from '../stores/config.js'

const LOADER_OPTIONS = [
  { value: '', label: '全部加载器' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'quilt', label: 'Quilt' },
]
const SORT_OPTIONS = [
  { value: 'downloads', label: '按下载量' },
  { value: 'follows', label: '按热度' },
  { value: 'newest', label: '按更新时间' },
  { value: 'relevance', label: '按相关度' },
]
const GAME_VERSIONS = ['1.21.4', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10']

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n ?? 0)
}
function fmtSize(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB'
  return n + ' B'
}
function fmtDate(s) {
  try { return new Date(s).toLocaleDateString('zh-CN') } catch { return s }
}

const PAGE_SIZE = 30 // 每页拉取数量，配合触底无限加载

export default function ModsPage() {
  const config = useConfigStore((s) => s.config)
  const [instances, setInstances] = useState([])
  const [instanceId, setInstanceId] = useState('')
  const [instanceInfo, setInstanceInfo] = useState(null) // { loader, gameVersion }
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loader, setLoader] = useState('')
  const [gameVersion, setGameVersion] = useState('')
  const [index, setIndex] = useState('downloads')
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [installedMods, setInstalledMods] = useState([])
  const [installing, setInstalling] = useState(null) // { phase, file }
  const [detail, setDetail] = useState(null) // 模组版本选择弹窗数据
  const [modVersions, setModVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [fabricGame, setFabricGame] = useState('1.21.1')
  const [fabricList, setFabricList] = useState([])
  const [fabricInstalling, setFabricInstalling] = useState('')
  const logRef = useRef(null)
  const scrollRef = useRef(null)
  const sentinelRef = useRef(null)
  const [logs, setLogs] = useState([])

  const pushLog = useCallback((msg) => {
    setLogs((prev) => [...prev.slice(-200), { msg, time: Date.now() }])
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 0)
  }, [])

  // 加载已安装实例列表
  const refreshInstances = useCallback(async () => {
    try {
      const data = await window.nal.download.listVersions()
      const inst = (data.installed || []).map((i) => i.id || i)
      setInstances(inst)
      return inst
    } catch { return [] }
  }, [])

  // 检测实例加载器信息
  const detectInfo = useCallback(async (id) => {
    if (!id) { setInstanceInfo(null); return }
    try {
      // 通过尝试列已装模组 + 从实例名推断
      const mods = await window.nal.mods.listInstalled(id)
      setInstalledMods(mods || [])
    } catch { setInstalledMods([]) }
    // 推断加载器：fabric-* 前缀
    if (id.startsWith('fabric-')) {
      const rest = id.replace(/^fabric-/, '')
      const parts = rest.split('-')
      setInstanceInfo({ loader: 'fabric', gameVersion: parts.slice(1).join('-') || parts[1] })
    } else if (id.includes('forge')) {
      setInstanceInfo({ loader: 'forge', gameVersion: id })
    } else {
      setInstanceInfo({ loader: 'vanilla', gameVersion: id })
    }
  }, [])

  useEffect(() => {
    (async () => {
      const inst = await refreshInstances()
      const preferred = inst.find((i) => i.startsWith('fabric-')) || inst[0] || ''
      setInstanceId(preferred)
    })()
    const unsub = window.nal.mods.onProgress((d) => {
      if (d?.phase) pushLog(d.file ? `${d.phase}: ${d.file}` : d.phase)
    })
    return () => unsub()
  }, [])

  useEffect(() => { detectInfo(instanceId) }, [instanceId, detectInfo])

  // 搜索模组（append=true 时追加结果，用于无限滚动加载更多）
  const doSearch = useCallback(async (off = 0, append = false) => {
    setLoading(true)
    if (!append) setError('')
    try {
      const data = await window.nal.mods.search({
        query, loader, gameVersion, index, limit: PAGE_SIZE, offset: off,
      })
      const hits = data.hits || []
      setResults((prev) => (append ? [...prev, ...hits] : hits))
      setTotal(data.total || 0)
      setOffset(off)
    } catch (e) {
      if (!append) {
        setError('搜索失败: ' + e.message + '（请检查网络连接，Modrinth 需要能访问国际网络）')
        setResults([])
      }
    } finally {
      setLoading(false)
    }
  }, [query, loader, gameVersion, index])

  // 筛选条件变化（含首次进入）时自动从 Modrinth 实时拉取
  useEffect(() => { doSearch(0) }, [doSearch])

  // 触底无限加载：滚动到列表底部附近时自动拉取下一页
  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading && results.length > 0 && results.length < total) {
        doSearch(offset + PAGE_SIZE, true)
      }
    }, { root, rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loading, results.length, total, offset, doSearch])

  // 安装模组
  const handleInstall = async (projectId, versionId = null) => {
    if (!instanceId) { setError('请先选择一个实例'); return }
    setInstalling({ phase: '准备安装', projectId })
    pushLog(`开始安装模组到 ${instanceId}...`)
    try {
      const r = await window.nal.mods.install({ projectId, instanceId, versionId })
      if (r.success) {
        const ok = r.installed.filter((i) => !i.skipped).length
        const skip = r.installed.filter((i) => i.skipped).length
        pushLog(`安装完成：新装 ${ok} 个${skip ? `，已存在跳过 ${skip} 个` : ''}${r.failed?.length ? `，失败 ${r.failed.length} 个` : ''}`)
      } else {
        pushLog('安装失败: ' + (r.error || '未知错误'))
        setError(r.error)
      }
      setInstalledMods(await window.nal.mods.listInstalled(instanceId))
    } catch (e) {
      pushLog('安装失败: ' + e.message)
      setError(e.message)
    } finally {
      setInstalling(null)
      setDetail(null)
    }
  }

  // 打开版本选择
  const openDetail = async (hit) => {
    setDetail({ ...hit })
    setVersionsLoading(true)
    try {
      const vs = await window.nal.mods.versions(hit.projectId, loader || instanceInfo?.loader || '', gameVersion || instanceInfo?.gameVersion || '')
      setModVersions(vs || [])
    } catch (e) {
      setModVersions([])
      setError('获取版本失败: ' + e.message)
    } finally {
      setVersionsLoading(false)
    }
  }

  // Fabric 安装
  const loadFabric = async (gv) => {
    setFabricList([])
    try { setFabricList(await window.nal.download.listFabric(gv)) } catch { setError('获取 Fabric 版本失败') }
  }
  const handleInstallFabric = async (lv) => {
    setFabricInstalling(`正在安装 Fabric ${lv} for ${fabricGame}...`)
    pushLog(`开始安装 Fabric ${lv} for ${fabricGame}`)
    try {
      const r = await window.nal.download.installFabric(fabricGame, lv)
      if (r.success) {
        pushLog(`Fabric 安装完成: ${r.instanceId}`)
        await refreshInstances()
        setInstanceId(r.instanceId)
      } else {
        pushLog('Fabric 安装失败: ' + r.error)
        setError(r.error)
      }
    } catch (e) {
      pushLog('Fabric 安装失败: ' + e.message)
    } finally {
      setFabricInstalling('')
    }
  }

  const loaderBadge = (l) => {
    const color = { fabric: '#d4a24a', forge: '#5b6ee1', quilt: '#9c5be1', vanilla: '#8a8f98', optifine: '#e15b5b' }[l] || '#8a8f98'
    return <span className="badge" style={{ background: color + '26', color }}>{l}</span>
  }

  return (
    <div ref={scrollRef} className="scroll-y" style={{ height: '100%', padding: '24px 28px' }}>
      <div className="page-header">
        <h1>模组安装</h1>
        <p className="text-secondary">来自 Modrinth 的海量模组，一键安装到实例（自动下载依赖）</p>
      </div>

      {/* 实例选择 + Fabric 安装 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="text-secondary" style={{ fontSize: 13 }}>目标实例：</label>
          <select className="select" style={{ width: 260 }} value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            {instances.length === 0 && <option value="">（暂无已安装版本，请先到下载页安装）</option>}
            {instances.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          {instanceInfo && loaderBadge(instanceInfo.loader)}
          {instanceInfo?.gameVersion && <span className="badge">游戏版本 {instanceInfo.gameVersion}</span>}
          {instanceInfo?.loader === 'vanilla' && (
            <span className="badge badge-warning">原版不能装模组，请先在下方安装 Fabric</span>
          )}
        </div>
      </div>

      {/* 搜索区 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input" style={{ flex: 1, minWidth: 220 }}
            placeholder="搜索模组，如： sodium / 创造模式 / 生物群系..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setQuery(searchInput) }}
          />
          <select className="select" style={{ width: 130 }} value={loader} onChange={(e) => setLoader(e.target.value)}>
            {LOADER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="select" style={{ width: 130 }} value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}>
            <option value="">全部游戏版本</option>
            {GAME_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="select" style={{ width: 120 }} value={index} onChange={(e) => setIndex(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setQuery(searchInput)} disabled={loading}>
            {loading ? '搜索中...' : '搜索'}
          </button>
          <button className="btn btn-ghost" onClick={() => doSearch(0)} disabled={loading} title="重新从 Modrinth 拉取最新数据">
            刷新
          </button>
        </div>
        {total > 0 && (
          <div className="text-tertiary" style={{ fontSize: 12, marginTop: 8 }}>
            共 {fmtNum(total)} 个结果（实时来自 Modrinth），已加载 {results.length} 个，滚动到底部自动加载更多
          </div>
        )}
      </div>

      {error && <div className="card" style={{ padding: 12, marginBottom: 16, borderColor: 'var(--error)', color: 'var(--error)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 模组列表 */}
        <div style={{ flex: 1 }}>
          {loading && <div className="card" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto 12px' }} /><div className="text-secondary">正在搜索 Modrinth...</div></div>}
          {!loading && results.length === 0 && !error && (
              <div className="card text-secondary" style={{ padding: 40, textAlign: 'center' }}>没有找到模组，换个关键词试试</div>
            )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {!loading && results.map((m) => (
              <div key={m.projectId} className="card" style={{ padding: 14, display: 'flex', gap: 12 }}>
                {m.iconUrl
                  ? <img src={m.iconUrl} alt="" style={{ width: 48, height: 48, borderRadius: 8, flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 8, flexShrink: 0, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--text-tertiary)' }}>{(m.title || '?')[0]}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                    <span className="text-tertiary" style={{ fontSize: 11 }}>⬇ {fmtNum(m.downloads)}</span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 12, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.description}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="text-tertiary" style={{ fontSize: 11 }}>by {m.author}</span>
                    {m.categories && m.categories.filter((c) => !['fabric', 'forge', 'quilt'].includes(c)).slice(0, 3).map((c) => (
                      <span key={c} className="badge" style={{ fontSize: 10 }}>{c}</span>
                    ))}
                    <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openDetail(m)} disabled={!!installing}>
                      {installing?.projectId === m.projectId ? '安装中...' : '安装'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* 触底无限加载 */}
          {!loading && results.length > 0 && (
            <div ref={sentinelRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 20, padding: '12px 0' }}>
              {results.length < total ? (
                <>
                  <div className="spinner" />
                  <div className="text-tertiary" style={{ fontSize: 12 }}>正在加载更多模组...（{results.length} / {fmtNum(total)}）</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => doSearch(offset + PAGE_SIZE, true)}>手动加载下一页</button>
                </>
              ) : (
                <div className="text-tertiary" style={{ fontSize: 12 }}>— 已加载全部 {fmtNum(total)} 个模组 —</div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：已装模组 + Fabric 安装 + 日志（sticky，滚动时保持可见） */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', paddingRight: 2 }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>已装模组（{installedMods.length}）</div>
            {installedMods.length === 0 && <div className="text-tertiary" style={{ fontSize: 12 }}>暂无模组</div>}
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {installedMods.map((m) => (
                <div key={m.filename} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.filename}>{m.filename}</span>
                  <span className="text-tertiary">{fmtSize(m.size)}</span>
                  <button className="btn btn-danger btn-sm" onClick={async () => {
                    await window.nal.mods.deleteMod(instanceId, m.filename)
                    setInstalledMods(await window.nal.mods.listInstalled(instanceId))
                  }}>删</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>安装 Fabric（模组前置）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="select" style={{ flex: 1 }} value={fabricGame} onChange={(e) => { setFabricGame(e.target.value); loadFabric(e.target.value) }}>
                {GAME_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => loadFabric(fabricGame)}>获取版本</button>
            </div>
            <div style={{ marginTop: 8, maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fabricList.slice(0, 8).map((f) => (
                <div key={f.loader} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{f.loader} {f.stable ? '' : '(beta)'}</span>
                  <button className="btn btn-primary btn-sm" disabled={!!fabricInstalling} onClick={() => handleInstallFabric(f.loader)}>安装</button>
                </div>
              ))}
              {fabricList.length === 0 && <div className="text-tertiary" style={{ fontSize: 12 }}>点击"获取版本"加载 Fabric loader 列表</div>}
            </div>
            {fabricInstalling && <div className="badge badge-warning" style={{ marginTop: 8 }}>{fabricInstalling}</div>}
          </div>

          {(logs.length > 0 || installing) && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>安装日志</div>
              {installing && <div style={{ marginBottom: 8 }}><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></div>}
              <div ref={logRef} style={{ maxHeight: 180, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {logs.map((l, i) => <div key={i}>[{new Date(l.time).toLocaleTimeString('zh-CN')}] {l.msg}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 版本选择弹窗 */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setDetail(null)}>
          <div className="card" style={{ width: 560, maxHeight: '80vh', padding: 20, overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              {detail.iconUrl && <img src={detail.iconUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{detail.title}</div>
                <div className="text-tertiary" style={{ fontSize: 12 }}>⬇ {fmtNum(detail.downloads)} · ♥ {fmtNum(detail.follows)} · {fmtDate(detail.dateModified)} 更新</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 14 }}>{detail.description}</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>选择版本安装到 {instanceId || '（未选择实例）'}</div>
            {versionsLoading && <div className="text-secondary" style={{ fontSize: 13 }}>加载版本中...</div>}
            {!versionsLoading && modVersions.length === 0 && <div className="text-tertiary" style={{ fontSize: 13 }}>没有兼容当前加载器/游戏版本的文件，试试调整筛选条件</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!versionsLoading && modVersions.slice(0, 15).map((v) => (
                <div key={v.id} className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-tertiary)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{v.versionNumber}</div>
                    <div className="text-tertiary" style={{ fontSize: 11 }}>
                      {v.loaders.join('/')} · ⬇ {fmtNum(v.downloads)} · {fmtDate(v.datePublished)}
                      {v.file && ` · ${fmtSize(v.file.size)}`}
                      {v.dependencies.some((d) => d.type === 'required') && ' · 含依赖'}
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={!instanceId || !!installing} onClick={() => handleInstall(detail.projectId, v.id)}>
                    {installing ? '...' : '安装'}
                  </button>
                </div>
              ))}
            </div>
            {!versionsLoading && modVersions.length > 0 && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={!instanceId || !!installing} onClick={() => handleInstall(detail.projectId)}>
                {installing ? '安装中...' : '安装最新版（推荐）'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

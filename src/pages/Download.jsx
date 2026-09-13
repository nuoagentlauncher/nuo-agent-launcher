// 下载页面：版本清单、版本类型筛选、安装进度、Java 状态
import { useEffect, useState, useRef } from 'react'
import { useConfigStore } from '../stores/config.js'

const SOURCE_OPTIONS = [
  { value: 'official', label: 'Mojang 官方源（推荐）' },
  { value: 'bmclapi', label: 'BMCLAPI 中国镜像' },
  { value: 'mcbbs', label: 'MCBBS 镜像' },
]

export default function DownloadPage() {
  const config = useConfigStore((s) => s.config)
  const setConfig = useConfigStore((s) => s.set)
  const [tab, setTab] = useState('java') // java / bedrock
  const [versions, setVersions] = useState([])
  const [installed, setInstalled] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('release')
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState(null) // { versionId, phase, percent }
  const [jreList, setJreList] = useState([])
  const [systemJava, setSystemJava] = useState([])
  const [installLog, setInstallLog] = useState([])
  const [error, setError] = useState('')

  const logBoxRef = useRef(null)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.nal.download.listVersions()
      setVersions(data.versions || [])
      setInstalled(data.installed || [])
      const jres = await window.nal.java.list()
      setJreList(jres)
      const sysJ = await window.nal.java.detect()
      setSystemJava(sysJ)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const unsubProgress = window.nal.download.onProgress((data) => {
      setInstalling(data)
    })
    const unsubLog = window.nal.download.onLog((entry) => {
      setInstallLog((prev) => [...prev.slice(-300), entry])
      setTimeout(() => {
        if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
      }, 0)
    })
    return () => { unsubProgress(); unsubLog() }
  }, [])

  const filteredVersions = versions.filter((v) => {
    if (filter === 'release' && v.type !== 'release') return false
    if (filter === 'snapshot' && v.type !== 'snapshot' && v.type !== 'old_beta' && v.type !== 'old_alpha') return false
    if (filter === 'all') return true
    if (filter === 'installed' && !v.installed) return false
    if (search && !v.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleInstall = async (versionId) => {
    setInstalling({ versionId, phase: '准备开始', percent: 0 })
    setInstallLog([])
    setError('')
    try {
      const result = await window.nal.download.installVersion(versionId, config.downloadSource)
      if (result.success) {
        refresh()
      } else {
        setError(result.error || '安装失败')
      }
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (versionId) => {
    if (!confirm(`确定删除版本 ${versionId}？`)) return
    await window.nal.download.deleteVersion(versionId)
    refresh()
  }

  const handleInstallJre = async (version) => {
    try {
      const result = await window.nal.java.install(`jre-${version}`)
      alert(`Java ${version} 安装完成`)
      refresh()
    } catch (e) {
      alert('Java 安装失败：' + e.message)
    }
  }

  const installJreState = installLog.length > 0

  return (
    <div className="scroll-y" style={{ height: '100%', padding: '32px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 className="text-2xl mb-4">下载中心</h1>

        {/* 顶部大分类：Java 版 / 基岩版 */}
        <div className="flex gap-2 mb-4">
          <button className={`btn ${tab === 'java' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('java')}>
            ☕ Java 版
          </button>
          <button className={`btn ${tab === 'bedrock' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('bedrock')}>
            🌱 基岩版（Windows 10/11）
          </button>
        </div>

        {tab === 'java' && (<>
        {/* 下载源 + Java 状态 */}
        <div className="card mb-4">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <label className="field-label">下载源</label>
              <select className="select" value={config.downloadSource || 'official'} onChange={(e) => setConfig('downloadSource', e.target.value)}>
                {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Java 运行时</label>
              <div className="text-sm text-secondary" style={{ padding: '8px 0' }}>
                已安装 JRE：<strong>{jreList.length}</strong> 个
                {systemJava.length > 0 && <> · 系统 Java：<strong>{systemJava.length}</strong> 个</>}
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => handleInstallJre(8)}>下载 JRE 8</button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleInstallJre(17)}>下载 JRE 17</button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleInstallJre(21)}>下载 JRE 21</button>
              </div>
            </div>
          </div>
          {jreList.length > 0 && (
            <div className="mt-4">
              <div className="text-sm text-tertiary mb-2">已安装 JRE 列表</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {jreList.map((j) => (
                  <span key={j.id} className="badge badge-success" style={{ display: 'inline-flex', gap: 8, padding: '4px 10px' }}>
                    Java {j.version} <button style={{ background: 'none', color: 'inherit', padding: 0, cursor: 'pointer' }} onClick={async () => { await window.nal.java.delete(j.id); refresh() }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 安装进度 */}
        {installing && (
          <div className="card mb-4" style={{ borderColor: 'var(--accent)' }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <strong>安装中：{installing.versionId || installing.taskId}</strong>
                <span className="text-secondary text-sm" style={{ marginLeft: 12 }}>{installing.phase}</span>
              </div>
              <div className="text-sm">{Math.round(installing.percent || 0)}%</div>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${installing.percent || 0}%` }} />
            </div>
            {installing.completed !== undefined && installing.total !== undefined && (
              <div className="text-xs text-tertiary mt-2">
                {installing.completed} / {installing.total}
                {installing.speed > 0 && <> · {(installing.speed / 1024).toFixed(1)} KB/s</>}
              </div>
            )}
            {installLog.length > 0 && (
              <div ref={logBoxRef} className="log-box mt-4" style={{ maxHeight: 160 }}>
                {installLog.map((l, i) => (
                  <div key={i} className={`log-line ${l.extra?.error ? 'log-error' : ''}`}>
                    <span className="log-time">{new Date(l.timestamp).toLocaleTimeString()}</span>
                    <span className="log-text">{l.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="card mb-4" style={{ borderColor: 'var(--error)', background: 'rgba(239,68,68,0.08)' }}>
            <div className="text-sm" style={{ color: 'var(--error)' }}>⚠ {error}</div>
          </div>
        )}

        {/* 已安装版本 */}
        <div className="card mb-4">
          <h2 className="text-lg mb-2" style={{ fontWeight: 600 }}>已安装版本（{installed.length}）</h2>
          {installed.length === 0 ? (
            <div className="text-secondary text-sm">还没有安装任何版本，请从下方列表选择安装</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {installed.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                  <div>
                    <strong>{v.id}</strong>
                    <span className="badge ml-2">{v.type}</span>
                    {!v.jarExists && <span className="badge badge-error ml-2">缺少 JAR</span>}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(v.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 版本清单 */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg" style={{ fontWeight: 600 }}>版本清单</h2>
            <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
              {loading ? <><span className="spinner" />刷新中</> : '↻ 刷新'}
            </button>
          </div>

          <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
            {[
              { value: 'release', label: '正式版' },
              { value: 'snapshot', label: '快照 / 旧版' },
              { value: 'installed', label: '已安装' },
              { value: 'all', label: '全部' },
            ].map((b) => (
              <button key={b.value} className={`btn btn-sm ${filter === b.value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(b.value)}>
                {b.label}
              </button>
            ))}
            <input className="input" style={{ flex: 1, maxWidth: 240 }} placeholder="搜索版本号..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {loading ? (
              <div className="text-center text-secondary text-sm" style={{ padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto 8px', width: 24, height: 24 }} />
                加载版本清单中...
              </div>
            ) : filteredVersions.length === 0 ? (
              <div className="text-center text-secondary text-sm" style={{ padding: 40 }}>无匹配版本</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {filteredVersions.map((v) => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                    <div>
                      <strong>{v.id}</strong>
                      <span className="badge ml-2">{v.type}</span>
                      {v.installed && <span className="badge badge-success ml-2">已安装</span>}
                    </div>
                    <div className="text-xs text-tertiary">
                      {v.releaseTime && new Date(v.releaseTime).toLocaleDateString()}
                    </div>
                    <div className="flex gap-2">
                      {v.installed ? (
                        <button className="btn btn-ghost btn-sm" disabled>已安装</button>
                      ) : (
                        <button className="btn btn-primary btn-sm" onClick={() => handleInstall(v.id)} disabled={installing}>
                          下载
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>)}

        {tab === 'bedrock' && <BedrockTab />}
      </div>

      <style>{`
        .field-label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .log-box { background: var(--log-bg); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 8px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 12px; }
        .log-line { padding: 1px 0; }
        .log-time { color: var(--text-muted); margin-right: 6px; }
        .log-text { color: var(--text-secondary); }
        .log-error .log-text { color: var(--error); }
        .ml-2 { margin-left: 8px; }
      `}</style>
    </div>
  )
}

// ==================== 基岩版标签页 ====================
const ARCH_LABEL = { x64: 'x64 · 64 位', x86: 'x86 · 32 位', arm64: 'ARM64', arm: 'ARM' }

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  return Math.round(bytes / 1024 / 1024) + ' MB'
}

function BedrockTab() {
  const [versions, setVersions] = useState([])
  const [fetchedAt, setFetchedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ringFilter, setRingFilter] = useState('all')
  const [archFilter, setArchFilter] = useState('all')
  const [downloaded, setDownloaded] = useState([])
  const [progress, setProgress] = useState(null)
  const [blog, setBlog] = useState([])
  const [installing, setInstalling] = useState('')

  const blogRef = useRef(null)

  const refresh = async (force) => {
    setLoading(true)
    setError('')
    try {
      const data = await window.nal.bedrock.list(force)
      setVersions(data.versions || [])
      setFetchedAt(data.fetchedAt)
      setDownloaded(await window.nal.bedrock.listDownloaded())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh(true)
    const u1 = window.nal.bedrock.onProgress((d) => {
      setProgress(d)
      if (d.done) {
        window.nal.bedrock.listDownloaded().then(setDownloaded)
      }
    })
    const u2 = window.nal.bedrock.onLog((e) => {
      setBlog((prev) => [...prev.slice(-100), e])
      setTimeout(() => { if (blogRef.current) blogRef.current.scrollTop = blogRef.current.scrollHeight }, 0)
    })
    return () => { u1(); u2() }
  }, [])

  const channels = [...new Set(versions.map((v) => v.channel))]
  const archs = [...new Set(versions.map((v) => v.arch))]
  const shown = versions.filter(
    (v) => (ringFilter === 'all' || v.channel === ringFilter) && (archFilter === 'all' || v.arch === archFilter)
  )
  const downloading = progress && !progress.done

  const handleDownload = async (item) => {
    setError('')
    setBlog([])
    const r = await window.nal.bedrock.download(item)
    if (!r.success) setError(r.error)
  }

  const handleInstall = async (f) => {
    if (!confirm(`将 ${f.fileName} 注册到系统（约 1-3 分钟）？\n\n安装后如游戏提示"需要许可证"，请打开微软商店登录账号授权一次即可。`)) return
    setInstalling(f.fileName)
    try {
      const r = await window.nal.bedrock.install(f.fileName)
      if (r.success) alert('安装完成！可在开始菜单找到 Minecraft。')
      else alert('安装失败：' + r.error)
    } catch (e) {
      alert('安装失败：' + e.message)
    } finally {
      setInstalling('')
    }
  }

  const handleDelete = async (f) => {
    if (!confirm(`删除已下载的 ${f.fileName}？`)) return
    await window.nal.bedrock.deleteFile(f.fileName)
    setDownloaded(await window.nal.bedrock.listDownloaded())
  }

  const handleLaunch = async () => {
    const r = await window.nal.bedrock.launch()
    if (!r.success) alert('启动失败：' + (r.error || '未安装基岩版'))
  }

  const openDir = async () => {
    try {
      const dir = await window.nal.bedrock.openDir()
      if (dir && window.nal.sys?.open) window.nal.sys.open(dir)
    } catch {}
  }

  return (
    <>
      {/* 渠道说明 + 刷新 */}
      <div className="card mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg" style={{ fontWeight: 600 }}>基岩版（Windows 10/11 UWP）</h2>
            <div className="text-sm text-secondary mt-1">
              完整版本列表实时来自 minecraft.wiki + 微软商店官方渠道；可下载版本直连微软官方 CDN；版本号与苹果/微软商店一致。
              {fetchedAt && <span className="text-tertiary"> · 更新于 {new Date(fetchedAt).toLocaleTimeString()}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => refresh(true)} disabled={loading}>
              {loading ? <><span className="spinner" />获取中</> : '↻ 实时刷新'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={openDir}>打开目录</button>
            <button className="btn btn-primary btn-sm" onClick={handleLaunch}>▶ 启动基岩版</button>
          </div>
        </div>
      </div>

      {/* 下载进度 */}
      {progress && (
        <div className="card mb-4" style={{ borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <strong>{progress.phase}</strong>
              {progress.gameVersion && <span className="text-secondary text-sm" style={{ marginLeft: 12 }}>版本 {progress.gameVersion} · {progress.channel} · {progress.arch}</span>}
            </div>
            <div className="text-sm">{Math.round(progress.percent || 0)}%</div>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress.percent || 0}%` }} />
          </div>
          {progress.received !== undefined && progress.total > 0 && (
            <div className="text-xs text-tertiary mt-2">
              {fmtSize(progress.received)} / {fmtSize(progress.total)}
              {progress.speed > 0 && <> · {(progress.speed / 1024 / 1024).toFixed(1)} MB/s</>}
            </div>
          )}
          {blog.length > 0 && (
            <div ref={blogRef} className="log-box mt-4" style={{ maxHeight: 140 }}>
              {blog.map((l, i) => (
                <div key={i} className={`log-line ${l.extra?.error ? 'log-error' : ''}`}>
                  <span className="log-time">{new Date(l.timestamp).toLocaleTimeString()}</span>
                  <span className="log-text">{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card mb-4" style={{ borderColor: 'var(--error)', background: 'rgba(239,68,68,0.08)' }}>
          <div className="text-sm" style={{ color: 'var(--error)' }}>⚠ {error}</div>
        </div>
      )}

      {/* 已下载的安装包 */}
      <div className="card mb-4">
        <h2 className="text-lg mb-2" style={{ fontWeight: 600 }}>已下载安装包（{downloaded.length}）</h2>
        {downloaded.length === 0 ? (
          <div className="text-secondary text-sm">还没有下载任何基岩版安装包，从下方版本列表选择下载</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {downloaded.map((f) => (
              <div key={f.fileName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>Minecraft 基岩版 {f.gameVersion}</strong>
                  <span className={`badge ml-2 ${f.channel === '正式版' ? 'badge-success' : ''}`}>{f.channel}</span>
                  {f.arch && <span className="badge ml-2">{ARCH_LABEL[f.arch] || f.arch}</span>}
                  <span className="text-xs text-tertiary ml-2">{fmtSize(f.size)}{f.packageVersion ? ` · 商店包 ${f.packageVersion}` : ''}</span>
                </div>
                <div className="flex gap-2" style={{ flexShrink: 0 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleInstall(f)} disabled={!!installing}>
                    {installing === f.fileName ? '安装中...' : '安装到系统'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(f)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-tertiary mt-2">提示：安装完成后，如果游戏提示"需要许可证"，请用微软商店登录已购买 Minecraft 的账号授权一次。</div>
      </div>

      {/* 版本列表（实时） */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg" style={{ fontWeight: 600 }}>版本列表（{shown.length}）</h2>
        </div>

        {/* 分类筛选：渠道 + 架构 */}
        <div className="flex gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
          <span className="text-sm text-tertiary" style={{ alignSelf: 'center' }}>类型：</span>
          {[{ value: 'all', label: '全部' }, ...channels.map((c) => ({ value: c, label: c }))].map((b) => (
            <button key={b.value} className={`btn btn-sm ${ringFilter === b.value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRingFilter(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
          <span className="text-sm text-tertiary" style={{ alignSelf: 'center' }}>架构：</span>
          {[{ value: 'all', label: '全部' }, ...archs.map((a) => ({ value: a, label: ARCH_LABEL[a] || a }))].map((b) => (
            <button key={b.value} className={`btn btn-sm ${archFilter === b.value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArchFilter(b.value)}>
              {b.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-secondary text-sm" style={{ padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto 8px', width: 24, height: 24 }} />
            正在从 minecraft.wiki + 微软商店实时获取完整版本列表...
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center text-secondary text-sm" style={{ padding: 40 }}>无匹配版本，试试切换架构或渠道筛选</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxHeight: 520, overflowY: 'auto' }}>
            {shown.map((v) => {
              const has = downloaded.some((f) => f.gameVersion === v.gameVersion && f.arch === v.arch && f.channel === v.channel)
              return (
                <div key={v.channel + v.gameVersion + v.arch + (v.packageVersion || '')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: v.archived ? 'var(--bg-tertiary)' : 'var(--bg-tertiary)', borderRadius: 'var(--radius)', opacity: v.archived ? 0.6 : 1 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>Minecraft 基岩版 {v.gameVersion}</strong>
                    {v.downloadable
                      ? <span className={`badge ml-2 ${v.channel === '正式版' ? 'badge-success' : ''}`}>{v.channel}</span>
                      : <span className="badge ml-2" style={{ background: 'var(--border-color)', color: 'var(--text-muted)' }}>已归档</span>
                    }
                    {v.downloadable && <span className="badge ml-2">{ARCH_LABEL[v.arch] || v.arch}</span>}
                    {has && <span className="badge badge-success ml-2">已下载</span>}
                    <div className="text-xs text-tertiary" style={{ marginTop: 3 }}>
                      {v.downloadable
                        ? `商店包版本 ${v.packageVersion} · 微软官方 CDN`
                        : '历史版本 · 微软商店已下架，无法下载'
                      }
                    </div>
                  </div>
                  <div>
                    {v.downloadable
                      ? <button className="btn btn-primary btn-sm" onClick={() => handleDownload(v)} disabled={!!downloading}>下载</button>
                      : <span className="text-xs text-tertiary">—</span>
                    }
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="text-xs text-tertiary mt-2">
          共 {versions.length} 个版本（实时来自 minecraft.wiki + 微软商店官方渠道），其中可下载 {versions.filter(v => v.downloadable).length} 个、历史归档 {versions.filter(v => v.archived).length} 个。
          当前正式版 {versions.find(v => v.channel === '正式版' && v.downloadable)?.gameVersion || '—'}、预览 {versions.find(v => v.channel === '预览版' && v.downloadable)?.gameVersion || '—'}。
          微软商店仅分发最新版，历史版本仅供参考。
        </div>
      </div>
    </>
  )
}

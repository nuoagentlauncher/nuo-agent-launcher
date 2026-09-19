// 关于页面：版本信息、功能列表、开源声明、真实更新检查、更新日志
import { useEffect, useState } from 'react'
import { useUpdaterStore, isDownloading } from '../stores/updater.js'
import pkg from '../../package.json'

const APP_VERSION = pkg.version

const FEATURES = [
  { name: '版本下载', desc: '原版 + Forge / Fabric / Optifine / NeoForge，BMCLAPI 镜像加速' },
  { name: 'Java 自动管理', desc: '按版本自动选择 JRE，缺失时一键下载安装（支持 Java 25）' },
  { name: '游戏启动', desc: '版本隔离、内存设置、native 提取、启动参数自动生成' },
  { name: '账号管理', desc: '离线 / 正版 Microsoft / 外置 Yggdrasil（authlib-injector）' },
  { name: '联机功能', desc: '房间创建、密码、局域网发现、UPnP 内网穿透' },
  { name: 'AI 助手', desc: '内置免费 AI 通道，无需 API 密钥，支持 AI 测速自动选最快通道' },
  { name: '日志系统', desc: '启动 / 下载 / Java / 联机 / AI 全类别日志，可导出' },
  { name: '自动更新', desc: '基于 GitHub Releases，自动检测新版、镜像加速下载、一键安装' },
]

// 简单 Markdown 渲染（更新日志正文：标题、列表、粗体、链接）
function renderNotes(md) {
  if (!md) return null
  return md.split('\n').map((raw, i) => {
    const line = raw.trim()
    if (!line) return <div key={i} style={{ height: 6 }} />
    if (/^#{1,4}\s/.test(line)) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 14, margin: '8px 0 4px' }}>{line.replace(/^#+\s/, '')}</div>
    }
    let content = line
    const isList = /^[-*]\s+/.test(content)
    content = content.replace(/^[-*]\s+/, '')
    // 粗体
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      /^\*\*[^*]+\*\*$/.test(seg)
        ? <strong key={j}>{seg.slice(2, -2)}</strong>
        : <span key={j}>{seg}</span>
    )
    return (
      <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        {isList && <span style={{ color: 'var(--accent)' }}>•</span>}
        <span>{parts}</span>
      </div>
    )
  })
}

export default function AboutPage() {
  const [appDir, setAppDir] = useState('')
  const [check, setCheck] = useState({ status: null, message: '', result: null })
  const [releases, setReleases] = useState(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releasesError, setReleasesError] = useState('')
  const [updateError, setUpdateError] = useState('')
  const download = useUpdaterStore((s) => s.download)
  const downloading = isDownloading(download)

  useEffect(() => {
    window.nal.system.getAppDir().then(setAppDir).catch(() => {})
  }, [])

  const handleCheckUpdate = async () => {
    setCheck({ status: 'checking', message: '正在检查更新...', result: null })
    try {
      const result = await window.nal.updater.check(false)
      if (result.hasUpdate) {
        setCheck({
          status: 'available',
          message: `发现新版本 v${result.latest}`,
          result,
        })
      } else {
        setCheck({ status: 'latest', message: `当前已是最新版本（v${result.current}）`, result })
      }
    } catch (e) {
      setCheck({ status: 'error', message: e.message || '检查更新失败，请检查网络', result: null })
    }
  }

  const loadReleases = async () => {
    setReleasesLoading(true)
    setReleasesError('')
    try {
      const list = await window.nal.updater.releases()
      setReleases(list)
    } catch (e) {
      setReleasesError(e.message || '获取更新日志失败')
    } finally {
      setReleasesLoading(false)
    }
  }

  const fmtSize = (bytes) => {
    if (!bytes && bytes !== 0) return ''
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''

  const fmtSpeed = (b) => {
    if (!b) return ''
    if (b >= 1024 * 1024) return `${(b / 1048576).toFixed(1)} MB/s`
    return `${(b / 1024).toFixed(0)} KB/s`
  }

  // 一键更新：应用内下载（镜像加速）并自动安装
  const handleUpdateNow = async () => {
    setUpdateError('')
    const res = await window.nal.updater?.downloadAndInstall?.().catch((e) => ({ success: false, error: e.message }))
    if (!res?.success) setUpdateError(res?.error || '更新失败，请稍后重试')
  }

  return (
    <div className="scroll-y" style={{ height: '100%', padding: '32px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Logo 与版本信息 */}
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{
            width: 80, height: 80, margin: '0 auto 20px', borderRadius: 22,
            background: 'linear-gradient(135deg, var(--accent), #7c4dff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 40, fontWeight: 700, color: '#fff',
            boxShadow: '0 8px 24px var(--accent-glow)',
          }}>N</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>nuo agent launcher</h1>
          <p className="text-secondary" style={{ marginBottom: 20 }}>
            功能丰富的 Minecraft 启动器 · v{APP_VERSION}
          </p>
          <div className="flex" style={{ gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={handleCheckUpdate} disabled={check.status === 'checking'}>
              {check.status === 'checking' ? <><span className="spinner" />检查中...</> : '检查更新'}
            </button>
            <button className="btn btn-ghost" onClick={() => window.nal.updater.openReleases()}>GitHub Releases</button>
          </div>
          {check.message && (
            <div className="text-sm mt-4" style={{
              color: check.status === 'available' ? 'var(--accent)'
                : check.status === 'error' ? 'var(--error)'
                : 'var(--success)',
              fontWeight: check.status === 'available' ? 600 : 400,
            }}>
              {check.message}
            </div>
          )}
          {/* 发现新版时展示一键更新 + 备用下载入口 */}
          {check.status === 'available' && check.result?.release && (
            <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', textAlign: 'left' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                v{check.result.latest} · {check.result.release.name}
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 12 }}>
                {renderNotes(check.result.release.notes)}
              </div>

              {/* 一键更新：自动下载（镜像加速）并安装 */}
              <div className="flex" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={handleUpdateNow} disabled={downloading}>
                  {downloading ? <><span className="spinner" />更新中...</> : '⚡ 一键更新（自动下载并安装）'}
                </button>
                {downloading && ['check', 'probe', 'download'].includes(download?.phase) && (
                  <button className="btn btn-ghost" onClick={() => window.nal.updater.cancelDownload()}>取消</button>
                )}
              </div>

              {/* 下载进度 */}
              {downloading && download && (
                <div style={{ marginBottom: 12 }}>
                  <div className="flex text-sm" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{download.message || '正在准备...'}</span>
                    <span className="text-tertiary" style={{ flexShrink: 0 }}>
                      {download.total
                        ? `${fmtSize(download.received)} / ${fmtSize(download.total)}${download.speed ? ` · ${fmtSpeed(download.speed)}` : ''}`
                        : download.received ? `${fmtSize(download.received)}${download.speed ? ` · ${fmtSpeed(download.speed)}` : ''}` : ''}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(3, download.percent || 0)}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .3s ease' }} />
                  </div>
                </div>
              )}
              {updateError && !downloading && (
                <div className="text-sm" style={{ color: 'var(--error)', marginBottom: 8 }}>更新失败：{updateError}</div>
              )}

              {/* 备用：浏览器手动下载 */}
              <div className="text-xs text-tertiary" style={{ marginBottom: 6 }}>或者用浏览器手动下载：</div>
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                {check.result.release.assets.map((a) => (
                  <button key={a.name} className="btn btn-ghost btn-sm" onClick={() => window.nal.updater.openUrl(a.url)}>
                    ⬇ {a.name} {a.size ? `(${fmtSize(a.size)})` : ''}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => window.nal.updater.openUrl(check.result.release.url)}>查看详情</button>
              </div>
            </div>
          )}
        </div>

        {/* 更新日志（从 GitHub Releases 实时拉取所有版本） */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="text-lg" style={{ fontWeight: 600 }}>更新日志</h2>
            <button className="btn btn-ghost btn-sm" onClick={loadReleases} disabled={releasesLoading}>
              {releasesLoading ? <><span className="spinner" />加载中...</> : releases ? '刷新' : '加载全部版本'}
            </button>
          </div>
          {releasesError && (
            <div className="text-sm" style={{ color: 'var(--error)', marginBottom: 8 }}>{releasesError}</div>
          )}
          {!releases && !releasesLoading && !releasesError && (
            <div className="text-sm text-tertiary">点击“加载全部版本”，实时获取 GitHub 上所有版本的更新记录。</div>
          )}
          {releases && releases.length === 0 && (
            <div className="text-sm text-tertiary">暂无已发布的版本。</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {releases?.map((r) => (
              <div key={r.version} style={{ padding: 14, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--accent)' }}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    v{r.version}
                    {r.prerelease && <span className="text-xs" style={{ marginLeft: 8, color: 'var(--warning)' }}>预览版</span>}
                  </div>
                  <div className="text-xs text-tertiary">{fmtDate(r.publishedAt)}</div>
                </div>
                {r.name && r.name !== r.version && (
                  <div className="text-sm" style={{ color: 'var(--text-secondary)', margin: '4px 0' }}>{r.name}</div>
                )}
                <div style={{ marginTop: 6 }}>{renderNotes(r.notes)}</div>
                {r.assets?.length > 0 && (
                  <div className="flex" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {r.assets.map((a) => (
                      <button key={a.name} className="btn btn-ghost btn-sm" onClick={() => window.nal.updater.openUrl(a.url)}>
                        ⬇ {a.name} ({fmtSize(a.size)})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 功能列表 */}
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="text-lg" style={{ fontWeight: 600, marginBottom: 16 }}>功能特性</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {FEATURES.map((f) => (
              <div key={f.name} style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{f.name}</div>
                <div className="text-sm text-secondary">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 数据目录 */}
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="text-lg" style={{ fontWeight: 600, marginBottom: 12 }}>应用数据目录</h2>
          <div className="text-sm text-secondary" style={{ fontFamily: 'Consolas, monospace', padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', wordBreak: 'break-all' }}>
            {appDir || '(未获取)'}
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-ghost btn-sm" onClick={() => appDir && window.nal.system.openPath(appDir)}>打开目录</button>
          </div>
          <div className="text-xs text-tertiary mt-4" style={{ lineHeight: 1.7 }}>
            版本、库、资源、Java、日志、账号等数据都存放在此目录。<br />
            切换电脑时可备份此目录以迁移所有数据。
          </div>
        </div>

        {/* 版权与开源 */}
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="text-lg" style={{ fontWeight: 600, marginBottom: 12 }}>开源与版权</h2>
          <div className="text-sm text-secondary" style={{ lineHeight: 1.8 }}>
            本项目已在 GitHub 开源：
            <a href="https://github.com/nuoagentlauncher/nuo-agent-launcher"
               onClick={(e) => { e.preventDefault(); window.nal.system.openUrl('https://github.com/nuoagentlauncher/nuo-agent-launcher') }}>
              github.com/nuoagentlauncher/nuo-agent-launcher
            </a>
            （MIT License）<br />
            Minecraft 是 Mojang AB / Microsoft 的商标，本启动器为第三方软件，与 Mojang、Microsoft 没有隶属关系。<br />
            技术栈：Electron + React + Vite
          </div>
        </div>

        <div className="text-center text-xs text-tertiary" style={{ marginTop: 24, marginBottom: 24 }}>
          © 2026 nuo agent launcher · MIT License
        </div>
      </div>
    </div>
  )
}

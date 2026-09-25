// 主页：版本选择 + 账号选择 + 启动按钮 + 启动进度 + 实时日志
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfigStore } from '../stores/config.js'

export default function HomePage() {
  const nav = useNavigate()
  const [versions, setVersions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [launchState, setLaunchState] = useState(null)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [showLog, setShowLog] = useState(false)
  const logBoxRef = useRef(null)

  // 启动诊断
  const [diag, setDiag] = useState(null)      // { issues, gpu, totalMemGB, allocMB }
  const [diagLoading, setDiagLoading] = useState(false)
  const [fixing, setFixing] = useState('')    // 正在修复的 fixKey
  const [aiResult, setAiResult] = useState(null) // { file, analysis }
  const [aiLoading, setAiLoading] = useState(false)

  const config = useConfigStore((s) => s.config)

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await window.nal.download.listInstalled()
      setVersions(data)
      if (data.length > 0 && !selectedVersion) setSelectedVersion(data[0].id)
      const accs = await window.nal.account.list()
      setAccounts(accs)
      const activeId = config.activeAccountId
      const target = accs.find((a) => a.id === activeId) || accs[0]
      if (target) setSelectedAccount(target.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const unsubLog = window.nal.launcher.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-500), entry])
      setTimeout(() => {
        if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
      }, 0)
    })
    const unsubState = window.nal.launcher.onState((entry) => {
      setLaunchState(entry.state)
      if (entry.state === 'exited' || entry.state === 'error') setLaunching(false)
    })
    return () => { unsubLog(); unsubState() }
  }, [])

  const handleLaunch = async () => {
    if (!selectedVersion) {
      setError('请先在下载页面安装一个版本')
      return
    }
    if (!selectedAccount) {
      setError('请先在设置页面添加账号')
      return
    }
    setLaunching(true)
    setLogs([])
    setError('')
    setShowLog(true)
    setLaunchState('preparing')
    try {
      const result = await window.nal.launcher.launch(selectedVersion, selectedAccount, {})
      if (!result.success) {
        setError(result.error)
        setLaunching(false)
      }
    } catch (e) {
      setError(e.message)
      setLaunching(false)
    }
  }

  const stateLabel = {
    preparing: '准备中',
    'preparing-java': '准备 Java',
    launching: '启动中',
    running: '运行中',
    exited: '已退出',
    error: '错误',
  }[launchState] || '空闲'

  // 运行启动诊断
  const runDiagnose = async () => {
    if (!selectedVersion) { setError('请先选择一个版本再诊断'); return }
    setDiagLoading(true); setDiag(null); setAiResult(null)
    try {
      const r = await window.nal.diagnose.run(selectedVersion)
      setDiag(r)
    } catch (e) { setError('诊断失败: ' + e.message) }
    finally { setDiagLoading(false) }
  }

  // 一键修复
  const runFix = async (issue) => {
    setFixing(issue.key)
    try {
      if (issue.fix === 'suggest-mod') { nav('/mods'); return }
      const r = await window.nal.diagnose.fix(selectedVersion, issue.fix, { javaVersion: issue.javaVersion })
      if (r.message && r.message !== 'SODIUM_IRIS') {
        // 修复完成后重新诊断
        const again = await window.nal.diagnose.run(selectedVersion)
        setDiag(again)
      }
    } catch (e) { setError('修复失败: ' + e.message) }
    finally { setFixing('') }
  }

  // AI 崩溃分析
  const runAiAnalyze = async () => {
    if (!selectedVersion) { setError('请先选择一个版本'); return }
    setAiLoading(true); setAiResult(null)
    try {
      const r = await window.nal.diagnose.analyze(selectedVersion)
      if (r.success) setAiResult(r)
      else setError(r.error || '未找到日志')
    } catch (e) { setError('AI 分析失败: ' + e.message) }
    finally { setAiLoading(false) }
  }

  return (
    <div className="home-page scroll-y" style={{ height: '100%', padding: '32px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Hero 区 */}
        <div className="hero">
          <div className="hero-bg" />
          <div className="hero-content">
            <h1 className="hero-title">NUO OS</h1>
            <p className="hero-subtitle">一键启动你的 Minecraft 世界 · 集成 Java 自动下载 · AI 助手 · 联机</p>
            <button className="btn btn-primary btn-lg launch-btn" onClick={handleLaunch} disabled={launching || loading}>
              {launching ? (
                <>
                  <span className="spinner" />
                  {stateLabel}...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  启动游戏
                </>
              )}
            </button>
            {launchState && (
              <div className="hero-state">
                <span className={`badge ${launchState === 'error' ? 'badge-error' : launchState === 'running' ? 'badge-success' : 'badge-warning'}`}>
                  {stateLabel}
                </span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="card" style={{ marginTop: 16, borderColor: 'var(--error)', background: 'rgba(239,68,68,0.08)' }}>
            <div className="flex items-center gap-3">
              <span style={{ color: 'var(--error)' }}>⚠</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--error)' }}>启动失败</div>
                <div className="text-sm text-secondary">{error}</div>
              </div>
            </div>
            {error.includes('版本') && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/download')}>前往下载</button>
            )}
            {error.includes('账号') && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/settings')}>前往添加账号</button>
            )}
          </div>
        )}

        {/* 版本 + 账号选择 */}
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <label className="field-label">游戏版本</label>
              <select className="select" value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} disabled={loading}>
                {versions.length === 0 && <option value="">未安装任何版本</option>}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{v.id} ({v.type}) {!v.jarExists ? ' · 缺少 JAR' : ''}</option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/download')}>管理版本 / 下载新版本</button>
            </div>
            <div>
              <label className="field-label">账号</label>
              <select className="select" value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} disabled={loading}>
                {accounts.length === 0 && <option value="">未添加账号</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/settings')}>管理账号</button>
            </div>
          </div>
        </div>

        {/* 启动诊断面板 */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="flex items-center justify-between">
            <div className="text-lg" style={{ fontWeight: 600 }}>🛠 启动诊断</div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={runAiAnalyze} disabled={aiLoading || !selectedVersion}>
                {aiLoading ? <><span className="spinner" /> AI 分析中...</> : '🤖 AI 崩溃分析'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={runDiagnose} disabled={diagLoading || !selectedVersion}>
                {diagLoading ? <><span className="spinner" /> 检测中...</> : '开始诊断'}
              </button>
            </div>
          </div>

          {!diag && !diagLoading && (
            <div className="text-tertiary text-sm" style={{ marginTop: 10 }}>
              启动失败、闪退、黑屏时，点「开始诊断」自动检测内存 / 显卡 / 核心文件 / Java，并一键修复；或用「AI 崩溃分析」让 AI 读取日志找根因。
            </div>
          )}

          {diag && (
            <div style={{ marginTop: 12 }}>
              {diag.issues.length === 0 ? (
                <div className="diag-ok">✓ 未发现问题，内存、显卡、核心文件、Java 均正常</div>
              ) : (
                diag.issues.map((it) => (
                  <div key={it.key} className={`diag-item diag-${it.level}`}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{it.level === 'error' ? '⛔' : '⚠'} {it.title}</div>
                      <div className="text-sm text-secondary" style={{ marginTop: 3 }}>{it.desc}</div>
                    </div>
                    {it.fix && (
                      <button className="btn btn-primary btn-sm" onClick={() => runFix(it)} disabled={!!fixing}>
                        {fixing === it.key ? <span className="spinner" /> : it.fixLabel}
                      </button>
                    )}
                  </div>
                ))
              )}
              {diag.gpu && diag.gpu.length > 0 && (
                <div className="text-tertiary" style={{ fontSize: 12, marginTop: 10 }}>
                  显卡：{diag.gpu.map((g) => g.name).join('、')} · 物理内存 {diag.totalMemGB}GB · 当前分配 {diag.allocMB}MB
                </div>
              )}
            </div>
          )}

          {aiResult && (
            <div className="ai-result">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>🤖 AI 分析结果（{aiResult.file}）</div>
              <div className="text-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{aiResult.analysis}</div>
            </div>
          )}
        </div>

        {/* 启动日志 */}
        {showLog && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg" style={{ fontWeight: 600 }}>启动日志</div>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setLogs([])}>清空</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowLog(false)}>隐藏</button>
              </div>
            </div>
            <div ref={logBoxRef} className="log-box">
              {logs.length === 0 ? <div className="text-tertiary text-sm">等待日志输出...</div> : logs.map((l, i) => (
                <div key={i} className={`log-line ${l.extra?.error ? 'log-error' : l.extra?.stream === 'stderr' ? 'log-warn' : ''}`}>
                  <span className="log-time">{new Date(l.timestamp).toLocaleTimeString()}</span>
                  <span className="log-text">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 快速入口 */}
        <div className="quick-cards">
          <QuickCard title="下载新版本" desc="官方 + Forge / Fabric / Optifine" icon="⬇" onClick={() => nav('/download')} />
          <QuickCard title="联机" desc="创建或加入房间" icon="👥" onClick={() => nav('/multiplayer')} />
          <QuickCard title="AI 助手" desc="DeepSeek V3 对话" icon="✨" onClick={() => nav('/ai')} />
          <QuickCard title="查看日志" desc="下载、Java、启动记录" icon="📋" onClick={() => nav('/logs')} />
        </div>
      </div>

      <style>{`
        .hero {
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          background: linear-gradient(135deg, #1a1f3a 0%, #2d1b4d 100%);
          padding: 48px 32px;
          border: 1px solid var(--border-color);
        }
        [data-theme="light"] .hero {
          background: linear-gradient(135deg, #e8eefb 0%, #f0e6ff 100%);
        }
        .hero-bg {
          position: absolute; inset: 0;
          background: radial-gradient(circle at 80% 20%, rgba(124, 77, 255, 0.3), transparent 50%),
                      radial-gradient(circle at 20% 80%, rgba(79, 158, 255, 0.3), transparent 50%);
        }
        [data-theme="light"] .hero-bg {
          background: radial-gradient(circle at 80% 20%, rgba(124, 77, 255, 0.15), transparent 50%),
                      radial-gradient(circle at 20% 80%, rgba(79, 158, 255, 0.15), transparent 50%);
        }
        .hero-content { position: relative; }
        .hero-title { font-size: 36px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        [data-theme="light"] .hero-title { color: #1a202c; }
        .hero-subtitle { color: rgba(255,255,255,0.7); margin-bottom: 24px; font-size: 14px; }
        [data-theme="light"] .hero-subtitle { color: rgba(26,32,44,0.65); }
        .launch-btn {
          padding: 14px 32px; font-size: 17px;
          background: linear-gradient(135deg, #4f9eff, #7c4dff);
          border: none;
        }
        .launch-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(79, 158, 255, 0.5); }
        .hero-state { margin-top: 16px; }
        .field-label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .log-box {
          background: var(--log-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius);
          padding: 12px;
          max-height: 280px;
          overflow-y: auto;
          font-family: 'Cascadia Code', 'Consolas', monospace;
          font-size: 12px;
        }
        .log-line { padding: 2px 0; line-height: 1.6; }
        .log-time { color: var(--text-muted); margin-right: 8px; }
        .log-text { color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; }
        .log-error .log-text { color: var(--error); }
        .log-warn .log-text { color: var(--warning); }
        .quick-cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-top: 24px;
        }
        .quick-card {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          padding: 16px;
          cursor: pointer;
          transition: all var(--transition);
        }
        .quick-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow); }
        .quick-card-icon { font-size: 24px; margin-bottom: 8px; }
        .quick-card-title { font-weight: 600; font-size: 14px; }
        .quick-card-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
        .diag-ok { padding: 12px; border-radius: var(--radius); background: rgba(34,197,94,0.1); color: var(--success); font-weight: 500; }
        .diag-item { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: var(--radius); margin-top: 8px; border: 1px solid var(--border-color); }
        .diag-error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.3); }
        .diag-warn { background: rgba(234,179,8,0.08); border-color: rgba(234,179,8,0.3); }
        .ai-result { margin-top: 12px; padding: 14px; border-radius: var(--radius); background: var(--bg-tertiary); border-left: 3px solid var(--accent); }
      `}</style>
    </div>
  )
}

function QuickCard({ title, desc, icon, onClick }) {
  return (
    <div className="quick-card" onClick={onClick}>
      <div className="quick-card-icon">{icon}</div>
      <div className="quick-card-title">{title}</div>
      <div className="quick-card-desc">{desc}</div>
    </div>
  )
}

// 日志页面：按类别展示、实时推送、导出、清空
import { useEffect, useState, useRef } from 'react'

const CATEGORIES = [
  { id: 'launcher', name: '启动日志', icon: '🚀' },
  { id: 'download', name: '下载日志', icon: '⬇️' },
  { id: 'java', name: 'Java 日志', icon: '☕' },
  { id: 'multiplayer', name: '联机日志', icon: '👥' },
  { id: 'ai', name: 'AI 日志', icon: '✨' },
  { id: 'account', name: '账号日志', icon: '👤' },
  { id: 'system', name: '系统日志', icon: '⚙️' },
]

const LEVEL_COLORS = {
  info: 'var(--text-secondary)',
  warn: 'var(--warning)',
  error: 'var(--error)',
  debug: 'var(--text-muted)',
}

export default function LogsPage() {
  const [activeCategory, setActiveCategory] = useState('launcher')
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const logBoxRef = useRef(null)

  const refresh = async (cat) => {
    const data = await window.nal.logs.getRecent(cat || activeCategory, 500)
    setLogs(data.reverse())
    setTimeout(() => {
      if (logBoxRef.current && autoScroll) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }, 0)
  }

  useEffect(() => {
    refresh(activeCategory)
    const unsub = window.nal.logs.onNewLog((entry) => {
      if (entry.category === activeCategory) {
        setLogs((prev) => [...prev.slice(-1000), entry])
        if (autoScroll) {
          setTimeout(() => {
            if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
          }, 0)
        }
      }
    })
    return () => unsub()
  }, [activeCategory, autoScroll])

  const filteredLogs = logs.filter((l) => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (filter && !l.message.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const handleExport = async () => {
    const path = await window.nal.logs.exportLogs(activeCategory)
    if (path) {
      await window.nal.system.openPath(path.replace(/\\[^\\]+\.log$/, ''))
    }
  }

  const handleClear = async () => {
    if (!confirm(`确定清空 ${CATEGORIES.find((c) => c.id === activeCategory)?.name}？`)) return
    await window.nal.logs.clear(activeCategory)
    refresh(activeCategory)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl" style={{ fontWeight: 600 }}>📋 日志 / 记录</h1>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => refresh()}>↻ 刷新</button>
            <button className="btn btn-ghost btn-sm" onClick={handleExport}>导出</button>
            <button className="btn btn-ghost btn-sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        {/* 类别 Tab */}
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`btn btn-sm ${activeCategory === c.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 筛选条 */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="过滤关键字..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select className="select" style={{ maxWidth: 140 }} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="all">全部级别</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="debug">debug</option>
        </select>
        <label className="text-sm flex items-center gap-2" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          自动滚动
        </label>
        <div className="text-xs text-tertiary ml-auto">共 {filteredLogs.length} 条</div>
      </div>

      {/* 日志区 */}
      <div ref={logBoxRef} className="scroll-y" style={{ flex: 1, background: 'var(--log-bg)', padding: '12px 16px', fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 12 }}>
        {filteredLogs.length === 0 ? (
          <div className="text-tertiary text-sm" style={{ textAlign: 'center', padding: 40 }}>暂无日志</div>
        ) : (
          filteredLogs.map((l, i) => (
            <div key={i} className="log-row" style={{ padding: '2px 0', borderBottom: '1px solid var(--log-row-border)', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                {new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0, width: 50, textTransform: 'uppercase' }}>
                {l.level}
              </span>
              <span style={{ color: LEVEL_COLORS[l.level] || 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {l.message}
              </span>
              {l.extra && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {typeof l.extra === 'string' ? l.extra : JSON.stringify(l.extra)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import HomePage from './pages/Home.jsx'
import DownloadPage from './pages/Download.jsx'
import ModsPage from './pages/Mods.jsx'
import MultiplayerPage from './pages/Multiplayer.jsx'
import AIPage from './pages/AI.jsx'
import LogsPage from './pages/Logs.jsx'
import SettingsPage from './pages/Settings.jsx'
import AboutPage from './pages/About.jsx'
import DeveloperPage from './pages/Developer.jsx'
import ColorsPage from './pages/Colors.jsx'
import { applyCustomColors } from './utils/themeColors.js'
import { useConfigStore } from './stores/config.js'

// 当前客户端版本（与 package.json 保持一致）
const APP_VERSION = '1.1.0'

const BASE_NAV_ITEMS = [
  { to: '/', label: '主页', icon: 'home' },
  { to: '/download', label: '下载', icon: 'download' },
  { to: '/mods', label: '模组', icon: 'mods' },
  { to: '/multiplayer', label: '联机', icon: 'multiplayer' },
  { to: '/ai', label: 'AI 助手', icon: 'ai' },
  { to: '/logs', label: '日志/记录', icon: 'logs' },
  { to: '/settings', label: '设置', icon: 'settings' },
  { to: '/about', label: '关于', icon: 'about' },
  // 开发者模块：与其他模块一样常驻侧边栏，进入时需要密码
  { to: '/developer', label: '开发者', icon: 'dev' },
]

// 开发者模式开启后额外解锁的菜单项（独立配色页）
const DEV_NAV_ITEMS = [
  { to: '/colors', label: '配色', icon: 'palette' },
]

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12L12 3l9 9M5 10v10h5v-6h4v6h5V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  mods: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.5 11H19V7a2 2 0 00-2-2h-4V3.5a2.5 2.5 0 00-5 0V5H4a2 2 0 00-2 2v3.8h1.5a2.7 2.7 0 010 5.4H2V20a2 2 0 002 2h3.8v-1.5a2.7 2.7 0 015.4 0V22H17a2 2 0 002-2v-4h1.5a2.5 2.5 0 000-5z" strokeLinejoin="round" />
    </svg>
  ),
  multiplayer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 100-6M22 20c0-3-3-5-6-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" strokeLinejoin="round" />
      <path d="M12 7v10M8 9.5l8 5M8 14.5l8-5" strokeLinecap="round" />
    </svg>
  ),
  logs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h7M7 17h5" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  about: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-7.7-9-7.7z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  dev: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="8 6 3 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="16 6 21 12 16 18" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="14" y1="4" x2="10" y2="20" strokeLinecap="round" />
    </svg>
  ),
}

function NavItem({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      <span className="nav-icon">{ICONS[icon]}</span>
      <span className="nav-label">{label}</span>
    </NavLink>
  )
}

export default function App() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [appDir, setAppDir] = useState('')
  const [updateInfo, setUpdateInfo] = useState(null)
  const config = useConfigStore()
  // 主题直接从 config store 读取，切换时实时响应
  const theme = useConfigStore((s) => s.config?.theme) || 'dark'
  // 开发者模式：开启后导航栏在“开发者”后面追加“配色”菜单项
  const devMode = !!useConfigStore((s) => s.config?.devMode)
  const navItems = devMode
    ? [...BASE_NAV_ITEMS, ...DEV_NAV_ITEMS]
    : BASE_NAV_ITEMS

  useEffect(() => {
    (async () => {
      try {
        const all = await window.nal.config.getAll()
        config.setAll(all || {})
        const dir = await window.nal.system.getAppDir()
        setAppDir(dir)
      } catch (e) {
        console.error('Init config failed:', e)
      } finally {
        setReady(true)
      }
    })()

    const unsubLog = window.nal.logs?.onNewLog?.(() => {})
    return () => unsubLog?.()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 监听主进程启动时静默检查到的新版本
  useEffect(() => {
    const unsub = window.nal.updater?.onUpdateAvailable?.((info) => {
      if (info?.hasUpdate) setUpdateInfo(info)
    })
    return () => unsub?.()
  }, [])

  // 应用自定义配色（通过注入 <style>：强调色全局生效，背景类仅深色主题生效）
  const customColors = useConfigStore((s) => s.config?.customColors)
  useEffect(() => {
    applyCustomColors(customColors)
  }, [customColors])

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          <div className="text-secondary text-sm">正在加载 nuo agent launcher...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-mark">N</div>
            <div className="logo-text">
              <div className="logo-title">nuo agent</div>
              <div className="logo-subtitle">launcher</div>
            </div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} end={item.to === '/'} />
          ))}
        </nav>
        <div className="sidebar-footer">
          {devMode && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
              padding: '4px 10px', borderRadius: 999, width: 'fit-content',
              fontSize: 11, fontWeight: 600,
              background: 'var(--success-dim, rgba(16,185,129,0.12))', color: 'var(--success)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
              开发者模式
            </div>
          )}
          <div className="version-badge">v{APP_VERSION}</div>
        </div>
      </aside>
      <main className="main-content">
        {updateInfo && (
          <div className="update-banner">
            <div className="update-banner-body">
              <span className="update-banner-icon">🎉</span>
              <div>
                <strong>发现新版本 v{updateInfo.latest}</strong>
                <span className="update-banner-current">（当前 v{updateInfo.current}）</span>
                <div className="update-banner-name">{updateInfo.release?.name || ''}</div>
              </div>
            </div>
            <div className="update-banner-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { navigate('/about'); setUpdateInfo(null) }}
              >
                立即更新
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setUpdateInfo(null)}>稍后</button>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/mods" element={<ModsPage />} />
          <Route path="/multiplayer" element={<MultiplayerPage />} />
          <Route path="/ai" element={<AIPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/colors" element={<ColorsPage />} />
        </Routes>
      </main>
      <style>{`
        .app-shell { display: flex; height: 100%; }
        .sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }
        .sidebar-header { padding: 20px 16px; border-bottom: 1px solid var(--border-color); }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-mark {
          width: 36px; height: 36px; border-radius: 10px;
          background: linear-gradient(135deg, var(--accent), #7c4dff);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 700; font-size: 18px;
          box-shadow: 0 4px 12px var(--accent-glow);
        }
        .logo-title { font-size: 14px; font-weight: 600; }
        .logo-subtitle { font-size: 11px; color: var(--text-tertiary); }
        .sidebar-nav { flex: 1; padding: 12px 8px; overflow-y: auto; }
        .nav-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px; border-radius: var(--radius);
          color: var(--text-secondary); font-size: 14px;
          transition: all var(--transition); margin-bottom: 2px;
        }
        .nav-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        .nav-item.active {
          background: var(--accent-dim); color: var(--accent);
          font-weight: 500;
        }
        .nav-icon { width: 20px; height: 20px; display: flex; flex-shrink: 0; }
        .nav-icon svg { width: 100%; height: 100%; }
        .sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border-color); }
        .version-badge { font-size: 11px; color: var(--text-muted); }
        .main-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
        .main-content > div:not(.update-banner) { flex: 1; min-height: 0; }
        .update-banner {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 10px 18px;
          background: linear-gradient(90deg, var(--accent-dim), transparent);
          border-bottom: 1px solid var(--accent);
          animation: bannerSlide .35s ease;
        }
        @keyframes bannerSlide { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .update-banner-body { display: flex; align-items: center; gap: 12px; font-size: 13.5px; }
        .update-banner-icon { font-size: 20px; }
        .update-banner-current { color: var(--text-secondary); font-size: 12px; margin-left: 6px; }
        .update-banner-name { color: var(--text-tertiary); font-size: 12px; }
        .update-banner-actions { display: flex; gap: 8px; flex-shrink: 0; }
      `}</style>
    </div>
  )
}

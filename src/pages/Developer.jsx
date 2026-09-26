// 开发者控制台（专门的开发者界面）
// 职责：进入时需要密码；登录后显示开发者模式状态、功能入口、系统信息；退出开发者模式只能在这里操作
// 注意：配色功能是独立页面（/colors），不在本界面内
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfigStore } from '../stores/config.js'
import Icon from '../components/Icon.jsx'
import pkg from '../../package.json'
const APP_VERSION = pkg.version

const DEV_PASSWORD = 'asdfghjkl123'

export default function DeveloperPage() {
  const navigate = useNavigate()
  const devMode = useConfigStore((s) => s.config?.devMode) || false
  const setConfig = useConfigStore((s) => s.set)
  const customColorsCount = useConfigStore((s) => Object.keys(s.config?.customColors || {}).length)
  const [appDir, setAppDir] = useState('')
  const [accountCount, setAccountCount] = useState(null)
  // 密码输入
  const [pwd, setPwd] = useState('')
  const [pwdError, setPwdError] = useState(false)

  useEffect(() => {
    if (!devMode) return
    window.nal.system?.getAppDir?.().then(setAppDir).catch(() => {})
    window.nal.account?.list?.().then((list) => setAccountCount(Array.isArray(list) ? list.length : 0)).catch(() => {})
  }, [devMode])

  const unlock = () => {
    if (pwd === DEV_PASSWORD) {
      setConfig('devMode', true)
      setPwdError(false)
      setPwd('')
    } else {
      setPwdError(true)
    }
  }

  // 退出开发者模式：这是唯一退出入口
  const exitDevMode = () => {
    setConfig('devMode', false)
    navigate('/')
  }

  // ============ 密码验证界面 ============
  if (!devMode) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{
          background: 'var(--bg-card)', borderRadius: 16, padding: 40, width: 380,
          boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-color)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 64, height: 64, margin: '0 auto 16px', borderRadius: 16,
              background: 'linear-gradient(135deg, var(--accent), #7c4dff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}><Icon name="code" size={32} /></div>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>开发者模式</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0 }}>请输入开发者密码以进入控制台</p>
          </div>
          <input
            type="password"
            value={pwd}
            onChange={(e) => { setPwd(e.target.value); setPwdError(false) }}
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
            placeholder="输入密码..."
            autoFocus
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 10, fontSize: 15,
              background: 'var(--bg-tertiary)', border: `1px solid ${pwdError ? 'var(--error)' : 'var(--border-color)'}`,
              color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {pwdError && <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>密码错误，请重试</div>}
          <button
            onClick={unlock}
            style={{
              width: '100%', marginTop: 16, padding: '12px', borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
              color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >验证密码</button>
        </div>
      </div>
    )
  }

  // ============ 开发者控制台 ============
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), #7c4dff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}><Icon name="code" size={20} /></div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>开发者控制台</h1>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>开发者模式已开启</p>
            </div>
          </div>
          {/* 退出按钮：只能在开发者界面退出 */}
          <button
            onClick={exitDevMode}
            style={{
              padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(239,68,68,0.12)', color: 'var(--error)',
              border: '1px solid rgba(239,68,68,0.3)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          ><Icon name="power" size={15} /> 退出开发者模式</button>
        </div>

        {/* 状态卡片 */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12, padding: 20,
          border: '1px solid var(--border-color)', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(16,185,129,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>开发者模式运行中</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              导航栏已解锁「配色」页面，退出开发者模式后这些入口会自动隐藏
            </div>
          </div>
        </div>

        {/* 开发者功能入口 */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12, padding: 20,
          border: '1px solid var(--border-color)', marginBottom: 20,
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>开发者功能</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            <button
              onClick={() => navigate('/colors')}
              style={{
                textAlign: 'left', padding: 16, borderRadius: 10, cursor: 'pointer',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-primary)',
              }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Icon name="palette" size={24} /></span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>启动器配色</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>修改主题色，独立页面</span>
              </span>
            </button>
          </div>
        </div>

        {/* 系统信息 */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12, padding: 20,
          border: '1px solid var(--border-color)',
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>系统信息</h3>
          <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            <InfoRow label="启动器版本" value={`NUO OS v${APP_VERSION}`} />
            <InfoRow label="运行平台" value={`${navigator.platform || 'Windows'} · Electron`} />
            <InfoRow label="数据目录" value={appDir || '读取中...'} mono />
            {accountCount !== null && <InfoRow label="已配置账号" value={`${accountCount} 个`} />}
            <InfoRow label="自定义配色" value={customColorsCount > 0 ? '已配置' : '默认'} />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-tertiary)', flex: '0 0 100px' }}>{label}</span>
      <span style={{
        color: 'var(--text-secondary)', wordBreak: 'break-all',
        fontFamily: mono ? "'Consolas', monospace" : 'inherit', fontSize: mono ? 12 : 13,
      }}>{value}</span>
    </div>
  )
}

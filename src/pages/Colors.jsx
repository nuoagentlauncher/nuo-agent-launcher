// 配色页面（独立页面，仅在开发者模式下可通过导航栏访问）
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfigStore } from '../stores/config.js'
import { hexToRgba, applyCustomColors, clearCustomColors } from '../utils/themeColors.js'

// 预设主题
const PRESETS = [
  { name: '默认蓝', accent: '#3b82f6', accentHover: '#2563eb', bg: '#0f1419', bgSec: '#161b22' },
  { name: '海洋蓝', accent: '#0ea5e9', accentHover: '#0284c7', bg: '#0c1929', bgSec: '#14233d' },
  { name: '翡翠绿', accent: '#10b981', accentHover: '#059669', bg: '#0a1f1a', bgSec: '#0f2e26' },
  { name: '烈焰红', accent: '#ef4444', accentHover: '#dc2626', bg: '#1a0a0a', bgSec: '#2a1010' },
  { name: '日落橙', accent: '#f97316', accentHover: '#ea580c', bg: '#1a0f0a', bgSec: '#2a1810' },
  { name: '皇家紫', accent: '#8b5cf6', accentHover: '#7c3aed', bg: '#120a1f', bgSec: '#1c1230' },
  { name: '樱花粉', accent: '#ec4899', accentHover: '#db2777', bg: '#1f0a14', bgSec: '#2e1020' },
  { name: '暗夜青', accent: '#14b8a6', accentHover: '#0d9488', bg: '#0a1a1f', bgSec: '#0f262e' },
]

export default function ColorsPage() {
  const navigate = useNavigate()
  const devMode = useConfigStore((s) => s.config?.devMode) || false
  const config = useConfigStore((s) => s.config)
  const setConfig = useConfigStore((s) => s.set)

  const [colors, setColors] = useState(config?.customColors || {})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saved, setSaved] = useState(false)

  // 实时预览：组装完整变量（含 accent 派生色）后注入 <style>
  const applyColors = useCallback((c) => {
    const full = { ...c }
    if (full.accent) {
      full['accent-dim'] = hexToRgba(full.accent, 0.1)
      full['accent-glow'] = hexToRgba(full.accent, 0.3)
    }
    applyCustomColors(full)
  }, [])

  const updateColor = (key, value) => {
    const newColors = { ...colors, [key]: value }
    setColors(newColors)
    applyColors(newColors)
    setSaved(false)
  }

  const applyPreset = (p) => {
    const newColors = {
      accent: p.accent,
      'accent-hover': p.accentHover,
      'bg-primary': p.bg,
      'bg-secondary': p.bgSec,
    }
    setColors(newColors)
    applyColors(newColors)
    setSaved(false)
  }

  const saveColors = () => {
    const toSave = { ...colors }
    if (toSave.accent) {
      toSave['accent-dim'] = hexToRgba(toSave.accent, 0.1)
      toSave['accent-glow'] = hexToRgba(toSave.accent, 0.3)
    }
    setConfig('customColors', toSave)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const resetColors = () => {
    setColors({})
    clearCustomColors()
    setConfig('customColors', {})
    setSaved(false)
  }

  // 未授权：理论上导航栏不会显示入口，直接访问路由时给出提示
  if (!devMode) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{
          background: 'var(--bg-card)', borderRadius: 16, padding: 40, width: 380, textAlign: 'center',
          boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-color)',
        }}>
          <div style={{
            width: 64, height: 64, margin: '0 auto 16px', borderRadius: 16,
            background: 'var(--bg-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
          }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>配色配置</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0, marginBottom: 20 }}>
            请先在「下载」页面点击底部 ⚡ 图标开启开发者模式
          </p>
          <button
            onClick={() => navigate('/download')}
            style={{
              width: '100%', padding: '12px', borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
              color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >前往下载页面</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), #7c4dff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>🎨</div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>启动器配色</h1>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>配色实时应用到整个启动器</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 预设主题 */}
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12, padding: 20,
            border: '1px solid var(--border-color)',
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>预设主题</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
              {PRESETS.map(p => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  style={{
                    padding: 0, borderRadius: 10, cursor: 'pointer', overflow: 'hidden',
                    border: '1px solid var(--border-color)', background: 'none',
                  }}
                >
                  <div style={{
                    height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `linear-gradient(135deg, ${p.accent}, ${p.accentHover})`,
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: p.bg, border: '2px solid rgba(255,255,255,0.3)',
                    }} />
                  </div>
                  <div style={{
                    padding: '8px', fontSize: 12, fontWeight: 500, textAlign: 'center',
                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  }}>{p.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 统一强调色 */}
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12, padding: 20,
            border: '1px solid var(--border-color)',
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>统一强调色</h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
              修改后整个启动器的按钮、选中项、高亮等全部统一变色
            </p>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <ColorPicker label="主题强调色" value={colors.accent || '#3b82f6'}
                onChange={v => updateColor('accent', v)} />
              <ColorPicker label="强调色(悬停)" value={colors['accent-hover'] || '#2563eb'}
                onChange={v => updateColor('accent-hover', v)} />
            </div>
          </div>

          {/* 高级配色 */}
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12, padding: 20,
            border: '1px solid var(--border-color)',
          }}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: 0, fontSize: 15, fontWeight: 600,
                background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
              }}
            >
              <span>高级配色</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{showAdvanced ? '▼ 收起' : '▶ 展开'}</span>
            </button>
            {showAdvanced && (
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 16 }}>
                <ColorPicker label="主背景色（自动生成渐变）" value={colors['bg-primary'] || '#0f1419'}
                  onChange={v => updateColor('bg-primary', v)} />
                <ColorPicker label="侧栏背景色" value={colors['bg-secondary'] || '#161b22'}
                  onChange={v => updateColor('bg-secondary', v)} />
                <ColorPicker label="卡片背景色" value={colors['bg-card'] || '#1c2333'}
                  onChange={v => updateColor('bg-card', v)} />
                <ColorPicker label="主文字色" value={colors['text-primary'] || '#e6edf3'}
                  onChange={v => updateColor('text-primary', v)} />
                <ColorPicker label="边框色" value={colors['border-color'] || '#30363d'}
                  onChange={v => updateColor('border-color', v)} />
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={saveColors}
              style={{
                padding: '12px 32px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                color: '#fff', border: 'none',
              }}
            >💾 保存配色</button>
            <button
              onClick={resetColors}
              style={{
                padding: '12px 32px', borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: 'pointer',
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >↺ 恢复默认</button>
            {saved && <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ 已保存，重启应用后依然生效</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ColorPicker({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: 44, height: 36, cursor: 'pointer', border: '1px solid var(--border-color)', borderRadius: 8, background: 'none' }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: 90, padding: '8px 10px', borderRadius: 8, fontSize: 13,
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
            color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace',
          }}
        />
      </div>
    </div>
  )
}

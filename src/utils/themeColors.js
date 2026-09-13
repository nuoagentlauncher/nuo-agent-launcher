// 自定义配色注入工具
// 强调色（accent 等）两种主题都生效；背景/文字/边框类深色变量仅在深色主题下生效，
// 避免浅色主题下内联深色值污染（导致“侧栏深色、卡片浅色”的色调错乱）。
const STYLE_ID = 'custom-theme-vars'

// 主题相关变量：自定义值只在深色主题下应用（浅色主题由 [data-theme=light] 接管）
const THEME_SCOPED_KEYS = [
  'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-card', 'bg-elevated',
  'text-primary', 'text-secondary', 'text-tertiary', 'text-muted',
  'border-color', 'border-light',
]

export function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return hex
  return `rgba(${r},${g},${b},${alpha})`
}

// ===== 颜色工具：用于生成渐变背景 =====
function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))) }

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return null
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const num = parseInt(h, 16)
  if (Number.isNaN(num) || h.length !== 6) return null
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')
}

// 混合两色：w=0 全 h1，w=1 全 h2
function mix(h1, h2, w) {
  const c1 = hexToRgb(h1)
  const c2 = hexToRgb(h2)
  if (!c1 || !c2) return h1
  return rgbToHex({ r: c1.r + (c2.r - c1.r) * w, g: c1.g + (c2.g - c1.g) * w, b: c1.b + (c2.b - c1.b) * w })
}

function lighten(hex, amt) { return mix(hex, '#ffffff', amt / 100) }
function darken(hex, amt) { return mix(hex, '#000000', amt / 100) }

// 相对亮度（0~1），用于判断深浅色
function luminance(hex) {
  const c = hexToRgb(hex)
  if (!c) return 0.5
  const a = [c.r, c.g, c.b].map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}

// 基于背景色生成协调的渐变：深色→提亮并微染强调色；浅色→压暗并微染强调色
function buildBgGradient(bg, accent) {
  if (!bg || !hexToRgb(bg)) return null
  const lum = luminance(bg)
  let start, end
  if (lum < 0.5) {
    start = darken(bg, 7)
    const lifted = lighten(bg, 12)
    end = accent ? mix(lifted, accent, 0.12) : lifted
  } else {
    start = lighten(bg, 5)
    const pressed = darken(bg, 5)
    end = accent ? mix(pressed, accent, 0.07) : pressed
  }
  return `linear-gradient(160deg, ${start} 0%, ${bg} 48%, ${end} 100%)`
}

// 将自定义配色注入为一个 <style> 标签（而非内联样式），保证主题选择器可以正确接管
export function applyCustomColors(colors) {
  let el = document.getElementById(STYLE_ID)
  if (!colors || Object.keys(colors).length === 0) {
    if (el) el.remove()
    return
  }

  const rootRules = []
  const darkRules = []
  for (const [k, v] of Object.entries(colors)) {
    if (!v) continue
    if (THEME_SCOPED_KEYS.includes(k)) {
      darkRules.push(`  --${k}: ${v};`)
    } else {
      rootRules.push(`  --${k}: ${v};`)
    }
  }

  // 自定义了主背景色时，自动派生渐变背景（仅深色主题，末端微染强调色）
  if (colors['bg-primary']) {
    const grad = buildBgGradient(colors['bg-primary'], colors.accent)
    if (grad) darkRules.push(`  --bg-gradient: ${grad};`)
  }

  let css = ''
  if (rootRules.length) css += `:root {\n${rootRules.join('\n')}\n}\n`
  if (darkRules.length) css += `[data-theme="dark"] {\n${darkRules.join('\n')}\n}\n`

  if (!css) {
    if (el) el.remove()
    return
  }

  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = css
}

// 清除自定义配色（恢复主题默认）
export function clearCustomColors() {
  const el = document.getElementById(STYLE_ID)
  if (el) el.remove()
}

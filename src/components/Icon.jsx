// 全站统一 SVG 图标库（线性风格，继承 currentColor）
// 用法：<Icon name="zap" size={16} />
const ICONS = {
  // 主导航
  home: <path d="M3 12L12 3l9 9M5 10v10h5v-6h4v6h5V10" />,
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />,
  mods: <path d="M20.5 11H19V7a2 2 0 00-2-2h-4V3.5a2.5 2.5 0 00-5 0V5H4a2 2 0 00-2 2v3.8h1.5a2.7 2.7 0 010 5.4H2V20a2 2 0 002 2h3.8v-1.5a2.7 2.7 0 015.4 0V22H17a2 2 0 002-2v-4h1.5a2.5 2.5 0 000-5z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 100-6M22 20c0-3-3-5-6-5" />
    </>
  ),
  ai: (
    <>
      <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" />
      <path d="M12 7v10M8 9.5l8 5M8 14.5l8-5" />
    </>
  ),
  logs: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h7M7 17h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-7.7-9-7.7z" />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  code: (
    <>
      <polyline points="8 6 3 12 8 18" />
      <polyline points="16 6 21 12 16 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </>
  ),
  // 通用动作 / 状态
  zap: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  check: <polyline points="20 6 9 17 4 12" />,
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.3-7-11a7 7 0 0114 0c0 4.7-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  heart: <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 000-7.8z" fill="currentColor" stroke="none" />,
  rocket: (
    <>
      <path d="M5 13c-2 2-2.5 5.5-2.5 8.5 3 0 6.5-.5 8.5-2.5M9 11a14 14 0 018-8c1.5 0 3 .5 4 1.5 1 1 1.5 2.5 1.5 4a14 14 0 01-8 8l-5.5-1.5L9 11z" />
      <circle cx="14.5" cy="9.5" r="1.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a2 2 0 012-2h2a2 2 0 012 2v1H9V4z" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 00-5.3 5.3L3 18l3 3 6.4-6.4a4 4 0 005.3-5.3l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z" />,
  bot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 8V4M12 4h-2M12 4h2" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <path d="M2 13v3M22 13v3M9 16h6" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5V8z" />
      <path d="M17 9h2.5a2.5 2.5 0 010 5H17" />
      <path d="M7 4v2M11 4v2M15 4v2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />,
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-8" />
      <path d="M12 13c0-3.3-2.7-6-6-6 0 3.3 2.7 6 6 6z" />
      <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6z" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5V3z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" />
      <path d="M5 12v9h14v-9M12 8v13" />
      <path d="M12 8S10.5 4 8 4 4.5 6 5.5 7 9 8 12 8zM12 8s1.5-4 4-4 3.5 2 2.5 3-4.5 1-6.5 1z" />
    </>
  ),
  refresh: (
    <>
      <polyline points="21 4 21 10 15 10" />
      <path d="M3 12a9 9 0 0115-5.3L21 10M3 20v-4h6" />
      <path d="M21 12a9 9 0 01-15 5.3L3 14" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3L3 9" />
      <polyline points="3 4 3 9 8 9" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.4 6.4a8 8 0 1011.2 0" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5-13-7.5z" fill="currentColor" stroke="none" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'chevron-up': <polyline points="6 15 12 9 18 15" />,
  'chevron-right': <polyline points="9 6 15 12 9 18" />,
}

export default function Icon({ name, size = 16, className = '', style, strokeWidth = 2, title }) {
  const node = ICONS[name]
  if (!node) return null
  return (
    <span
      className={`ui-icon ${className}`}
      title={title}
      aria-hidden={title ? undefined : 'true'}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        lineHeight: 0,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {node}
      </svg>
    </span>
  )
}

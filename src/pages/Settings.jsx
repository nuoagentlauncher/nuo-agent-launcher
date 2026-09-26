// 设置页面：游戏路径、Java 内存、下载源、主题、AI、账号管理
import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/config.js'
import Icon from '../components/Icon.jsx'

const SECTIONS = [
  { id: 'general', name: '通用', icon: 'settings' },
  { id: 'java', name: 'Java & 启动', icon: 'coffee' },
  { id: 'account', name: '账号', icon: 'user' },
  { id: 'ai', name: 'AI 助手', icon: 'sparkles' },
  { id: 'about', name: '数据 & 关于', icon: 'folder' },
]

export default function SettingsPage() {
  const [section, setSection] = useState('general')
  const config = useConfigStore((s) => s.config)
  const set = useConfigStore((s) => s.set)
  const [saved, setSaved] = useState(false)

  const update = (key, value) => {
    set(key, value)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      {/* 左侧分类 */}
      <aside style={{ width: 220, borderRight: '1px solid var(--border-color)', padding: '16px 8px', background: 'var(--bg-secondary)' }}>
        <div className="text-tertiary text-xs" style={{ padding: '0 12px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>设置分类</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`nav-item ${section === s.id ? 'active' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 'var(--radius)',
              color: section === s.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: section === s.id ? 'var(--accent-dim)' : 'transparent',
              width: '100%', fontSize: 14,
            }}
            onClick={() => setSection(s.id)}
          >
            <span className="nav-s-icon"><Icon name={s.icon} size={17} /></span>
            <span>{s.name}</span>
          </button>
        ))}
        {saved && <div className="text-xs" style={{ color: 'var(--success)', padding: '12px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name="check" size={14} /> 已保存</div>}
      </aside>

      {/* 右侧内容 */}
      <div className="scroll-y" style={{ flex: 1, padding: '32px' }}>
        <div style={{ maxWidth: 720 }}>
          {section === 'general' && <GeneralSection config={config} update={update} />}
          {section === 'java' && <JavaSection config={config} update={update} />}
          {section === 'account' && <AccountSection config={config} update={update} />}
          {section === 'ai' && <AISection config={config} update={update} />}
          {section === 'about' && <DataSection config={config} update={update} />}
        </div>
      </div>
    </div>
  )
}

function GeneralSection({ config, update }) {
  const [appDir, setAppDir] = useState('')
  useEffect(() => { window.nal.system.getAppDir().then(setAppDir) }, [])

  const pickDir = async (field) => {
    const path = await window.nal.system.pickDirectory()
    if (path) update(field, path)
  }

  return (
    <Section title="通用设置">
      <Field label="游戏根目录" hint="Minecraft 游戏数据存储位置">
        <div className="flex gap-2">
          <input className="input" value={config.gameRoot || appDir || ''} readOnly style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => pickDir('gameRoot')}>浏览</button>
        </div>
      </Field>

      <Field label="主题">
        <select className="select" value={config.theme || 'dark'} onChange={(e) => update('theme', e.target.value)} style={{ maxWidth: 200 }}>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </Field>

      <Field label="下载源">
        <select className="select" value={config.downloadSource || 'bmclapi'} onChange={(e) => update('downloadSource', e.target.value)} style={{ maxWidth: 280 }}>
          <option value="bmclapi">BMCLAPI（中国镜像，推荐）</option>
          <option value="official">Mojang 官方源</option>
          <option value="mcbbs">MCBBS 镜像</option>
        </select>
      </Field>

      <Field label="启动器更新镜像" hint="下载启动器自身更新包时使用的线路，自动测速会选最快的">
        <select className="select" value={config.updateMirror || 'auto'} onChange={(e) => update('updateMirror', e.target.value)} style={{ maxWidth: 280 }}>
          <option value="auto">自动测速（推荐）</option>
          <option value="ghfast">GHFast 镜像</option>
          <option value="ghproxy">GH-Proxy 镜像</option>
          <option value="ghproxynet">GHProxy.NET 镜像</option>
          <option value="gitmirror">GitMirror 镜像</option>
          <option value="direct">官方直连</option>
        </select>
      </Field>

      <Field label="启动时显示快照版本">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.showSnapshotVersions || false} onChange={(e) => update('showSnapshotVersions', e.target.checked)} />
          在主页版本列表中包含快照版本
        </label>
      </Field>
    </Section>
  )
}

function JavaSection({ config, update }) {
  return (
    <Section title="Java 与启动设置">
      <Field label="JVM 最大内存 (MB)" hint="建议设置为物理内存的 1/4 ~ 1/2">
        <input className="input" type="number" min="512" max="32768" value={config.javaMemory || 2048} onChange={(e) => update('javaMemory', parseInt(e.target.value, 10))} style={{ maxWidth: 200 }} />
      </Field>

      <Field label="额外 JVM 参数">
        <textarea
          className="textarea"
          rows="2"
          value={config.javaExtraArgs || '-XX:+UseG1GC -XX:+UseAdaptiveSizePolicy'}
          onChange={(e) => update('javaExtraArgs', e.target.value)}
        />
      </Field>

      <Field label="自动选择 Java" hint="启动游戏时根据版本自动选择最合适的 JRE；缺失时自动下载">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.autoSelectJava !== false} onChange={(e) => update('autoSelectJava', e.target.checked)} />
          自动管理 Java
        </label>
      </Field>

      <Field label="启动时显示日志">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.showLogOnLaunch !== false} onChange={(e) => update('showLogOnLaunch', e.target.checked)} />
          启动游戏时自动显示启动日志
        </label>
      </Field>

      <Field label="Java 版本规则" hint="启动器会按以下规则自动匹配">
        <div className="text-sm text-secondary" style={{ lineHeight: 1.8, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
          • Minecraft 1.16.4 及之前 → JRE 8<br />
          • Minecraft 1.17 ~ 1.20.4 → JRE 17<br />
          • Minecraft 1.20.5 及之后 → JRE 21<br />
          • 优先使用已安装的 JRE，其次检测系统 Java，最后自动下载
        </div>
      </Field>
    </Section>
  )
}

function AccountSection({ config, update }) {
  const [accounts, setAccounts] = useState([])
  const [newOffline, setNewOffline] = useState('')

  const refresh = async () => {
    const list = await window.nal.account.list()
    setAccounts(list)
  }

  useEffect(() => { refresh() }, [])

  const addOffline = async () => {
    if (!newOffline.trim()) return
    await window.nal.account.addOffline(newOffline.trim())
    setNewOffline('')
    refresh()
  }

  const addMicrosoft = async () => {
    const result = await window.nal.account.addMicrosoft()
    // 显示设备代码和登录链接
    if (result.userCode) {
      alert(`请在浏览器打开以下链接，输入设备代码完成登录：\n\n链接：${result.verificationUri}\n设备代码：${result.userCode}\n\n（演示版：完整 Microsoft 认证流程需要 XBL/XSTS/Minecraft 链式调用，已在后端预留接口）`)
    }
    refresh()
  }

  const [yggServer, setYggServer] = useState('https://littleskin.cn/api/yggdrasil')
  const [yggEmail, setYggEmail] = useState('')
  const [yggPassword, setYggPassword] = useState('')

  const addYgg = async () => {
    if (!yggEmail || !yggPassword) return
    try {
      await window.nal.account.addYggdrasil(yggServer, yggEmail, yggPassword)
      setYggEmail(''); setYggPassword('')
      refresh()
    } catch (e) {
      alert('外置登录失败：' + e.message)
    }
  }

  return (
    <Section title="账号管理">
      <Field label="已添加账号">
        {accounts.length === 0 ? (
          <div className="text-tertiary text-sm">未添加任何账号</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-3">
                  <span className="badge">{a.type}</span>
                  <strong>{a.name}</strong>
                  {config.activeAccountId === a.id && <span className="badge badge-success">当前使用</span>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await window.nal.account.setActive(a.id); update('activeAccountId', a.id); }}>设为活跃</button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await window.nal.account.remove(a.id); refresh() }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="添加离线账号">
        <div className="flex gap-2">
          <input className="input" placeholder="游戏名" value={newOffline} onChange={(e) => setNewOffline(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOffline()} />
          <button className="btn btn-primary" onClick={addOffline}>添加</button>
        </div>
        <div className="text-xs text-tertiary mt-2">离线账号适用于单机或离线模式联机</div>
      </Field>

      <Field label="添加正版 Microsoft 账号">
        <button className="btn btn-ghost" onClick={addMicrosoft}>
          + 添加 Microsoft 账号
        </button>
        <div className="text-xs text-tertiary mt-2">正版账号可访问正版服务器、皮肤同步</div>
      </Field>

      <Field label="添加外置登录（Yggdrasil / authlib-injector）">
        <div style={{ display: 'grid', gap: 8 }}>
          <input className="input" placeholder="Yggdrasil API 链接（默认 LittleSkin）" value={yggServer} onChange={(e) => setYggServer(e.target.value)} />
          <input className="input" placeholder="邮箱" value={yggEmail} onChange={(e) => setYggEmail(e.target.value)} />
          <input className="input" type="password" placeholder="密码" value={yggPassword} onChange={(e) => setYggPassword(e.target.value)} />
          <button className="btn btn-primary" onClick={addYgg}>添加外置账号</button>
        </div>
        <div className="text-xs text-tertiary mt-2">支持 LittleSkin 等兼容 authlib-injector 的皮肤站</div>
      </Field>
    </Section>
  )
}

function AISection({ config, update }) {
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const speedTest = async () => {
    setTesting(true)
    const result = await window.nal.ai.speedTest()
    setTestResult(result)
    setTesting(false)
  }

  return (
    <Section title="AI 助手设置">
      <Field label="连接状态" hint="内置免费通道，无需任何 API 密钥，开箱即用">
        <button className="btn btn-ghost" onClick={speedTest} disabled={testing}>
          {testing ? <><span className="spinner" />测速中</> : <><Icon name="zap" size={15} /> AI 测速</>}
        </button>
        {testResult && (
          <div className="text-sm mt-4" style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', display: 'grid', gap: 6 }}>
            {testResult.success ? (
              <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={15} /> 最快通道：{testResult.fastest.source} · {testResult.fastest.model}（{testResult.fastest.latencyMs}ms），已自动优先生效
              </div>
            ) : (
              <div style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="close" size={15} /> 所有通道暂时不可用，请稍后重试</div>
            )}
            {testResult.results?.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="badge">{r.source}</span>
                <span style={{ fontFamily: 'monospace' }}>{r.model}</span>
                {r.ok ? (
                  <span style={{ color: r.latencyMs < 5000 ? 'var(--success)' : 'var(--warning)' }}>{r.latencyMs}ms</span>
                ) : (
                  <span style={{ color: 'var(--error)' }} title={r.error}>失败</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="关于内置免费通道" hint="点击查看说明">
        <div className="text-sm text-secondary" style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', lineHeight: 1.7 }}>
          启动器内置多个免费 AI 通道（无需任何密钥、无需任何配置），开箱即用，多个模型自动切换。<br />
          使用「AI 测速」可检测各通道延迟，并自动把最快的通道排到最前。<br />
          免费通道限流约每分钟 2 次，繁忙时启动器会自动排队等待并重试。
        </div>
      </Field>
    </Section>
  )
}

function DataSection({ config, update }) {
  const [appDir, setAppDir] = useState('')
  useEffect(() => { window.nal.system.getAppDir().then(setAppDir) }, [])

  return (
    <Section title="数据目录与维护">
      <Field label="应用数据目录" hint="包含版本、库、资源、Java、日志、账号等">
        <div className="flex gap-2">
          <input className="input" value={appDir} readOnly style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => window.nal.system.openPath(appDir)}>打开</button>
        </div>
      </Field>

      <Field label="更新通道">
        <select className="select" value={config.updateChannel || 'stable'} onChange={(e) => update('updateChannel', e.target.value)} style={{ maxWidth: 200 }}>
          <option value="stable">稳定版</option>
          <option value="beta">测试版</option>
        </select>
      </Field>

      <Field label="重置启动器">
        <button className="btn btn-danger" onClick={() => {
          if (confirm('确定重置所有设置到默认值？版本和账号数据不会丢失。')) {
            update('theme', 'dark')
            update('javaMemory', 2048)
            update('downloadSource', 'bmclapi')
            update('javaExtraArgs', '-XX:+UseG1GC -XX:+UseAdaptiveSizePolicy')
          }
        }}>重置设置</button>
      </Field>
    </Section>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h1 className="text-2xl mb-4">{title}</h1>
      <div className="card" style={{ display: 'grid', gap: 20 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint && <div className="text-xs text-tertiary mt-2">{hint}</div>}
      <style>{`.field-label { display: block; margin-bottom: 8px; font-size: 13px; color: var(--text-secondary); font-weight: 500; }`}</style>
    </div>
  )
}

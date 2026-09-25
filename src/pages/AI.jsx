// AI 助手页面：聊天界面，流式响应，DeepSeek V3
import { useEffect, useState, useRef } from 'react'
import { useConfigStore } from '../stores/config.js'

const QUICK_PROMPTS = [
  'Minecraft 1.21 推荐什么模组？',
  '如何在 Minecraft 中合成蛋糕？',
  '如何在 NUO OS 中下载 Forge？',
  '解释 Java 8 / 17 / 21 在 Minecraft 中的区别',
  '帮我写一个 Minecraft 命令方块脚本',
  '解释 Minecraft 1.20 的红石更新',
]

const SYSTEM_PROMPT = {
  role: 'system',
  content: '你是 NUO OS 内置的 AI 助手。请用简洁清晰的中文回答问题，针对 Minecraft 玩家和启动器用户的需求提供帮助。可以使用 Markdown 格式排版。不要输出思考过程，直接给出回答。',
}

export default function AIPage() {
  const config = useConfigStore((s) => s.config)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [proxyState, setProxyState] = useState(null)

  const handleSpeedTest = async () => {
    setProxyState({ testing: true })
    const result = await window.nal.ai.speedTest()
    setProxyState(result)
  }
  const messagesEndRef = useRef(null)
  const reqIdRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const unsubChunk = window.nal.ai.onChunk((data) => {
      setStreamingText((prev) => prev + data.text)
    })
    const unsubDone = window.nal.ai.onDone((data) => {
      reqIdRef.current = null
      setStreamingText('')
      setStatus('')
      if (data.fullText) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.fullText }])
      }
      setLoading(false)
    })
    const unsubError = window.nal.ai.onError((data) => {
      reqIdRef.current = null
      setStreamingText('')
      setStatus('')
      setLoading(false)
      setError(data.error)
    })
    const unsubStatus = window.nal.ai.onStatus((data) => {
      setStatus(data.status || '')
    })
    return () => { unsubChunk(); unsubDone(); unsubError(); unsubStatus() }
  }, [])

  const handleSend = async (text) => {
    text = (text ?? input).trim()
    if (!text || loading) return
    setError('')
    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setStreamingText('')

    try {
      const result = await window.nal.ai.chat([SYSTEM_PROMPT, ...newMessages], {
        maxTokens: 2048,
        temperature: 0.7,
      })
      reqIdRef.current = result.reqId
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  const handleStop = () => {
    if (reqIdRef.current) {
      window.nal.ai.cancel(reqIdRef.current)
      reqIdRef.current = null
    }
    setLoading(false)
    if (streamingText) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamingText }])
    }
    setStreamingText('')
  }

  const handleClear = () => {
    setMessages([])
    setError('')
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="text-xl" style={{ fontWeight: 600 }}>✨ AI 助手</h1>
          <div className="text-xs text-tertiary">内置免费 AI 通道 · 无需 API 密钥 · 开箱即用</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={handleSpeedTest} disabled={proxyState?.testing}>
            {proxyState?.testing ? <><span className="spinner" />测速中</> : '⚡ AI 测速'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleClear}>清空对话</button>
        </div>
      </div>

      {/* 测速结果 */}
      {proxyState && !proxyState.testing && (
        <div className="card" style={{ margin: '12px 24px', padding: '12px 16px', borderColor: proxyState.success ? 'var(--success)' : 'var(--error)' }}>
          <div className="text-sm mb-2">
            <strong>AI 测速：</strong>
            {proxyState.success ? (
              <span style={{ color: 'var(--success)' }}>
                ✓ 最快通道 {proxyState.fastest.source} · {proxyState.fastest.model}（{proxyState.fastest.latencyMs}ms），已自动优先生效
              </span>
            ) : (
              <span style={{ color: 'var(--error)' }}>✗ 所有通道暂时不可用，请稍后重试</span>
            )}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {proxyState.results?.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-xs" style={{ padding: '6px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <span className="badge">{r.source}</span>
                <span style={{ fontFamily: 'monospace' }}>{r.model}</span>
                <span style={{ flex: 1 }}>
                  <span style={{
                    display: 'inline-block', height: 6, borderRadius: 3,
                    width: `${Math.max(4, Math.min(100, Math.round((r.latencyMs / 20000) * 100)))}%`,
                    background: r.ok ? (r.latencyMs < 5000 ? 'var(--success)' : 'var(--warning)') : 'var(--error)',
                  }} />
                </span>
                {r.ok ? (
                  <span style={{ color: r.latencyMs < 5000 ? 'var(--success)' : 'var(--warning)' }}>{r.latencyMs}ms</span>
                ) : (
                  <span style={{ color: 'var(--error)' }} title={r.error}>失败</span>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-tertiary mt-2">测速会自动把最快的通道排到最前；免费通道限流约每分钟 2 次，偶尔需排队等待。</div>
        </div>
      )}

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {messages.length === 0 && !streamingText ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
              <h2 className="text-xl" style={{ fontWeight: 600, marginBottom: 8 }}>你好！我是 NUO OS 的 AI 助手</h2>
              <p className="text-secondary text-sm" style={{ marginBottom: 24 }}>内置免费 AI 通道 · 开箱即用 · 询问任何 Minecraft 或启动器相关的问题</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 600, margin: '0 auto' }}>
                {QUICK_PROMPTS.map((q, i) => (
                  <button key={i} className="btn btn-ghost" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => handleSend(q)}>
                    <span className="text-tertiary">›</span> {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              {streamingText && <MessageBubble role="assistant" content={streamingText} streaming />}
              {loading && !streamingText && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                  <span className="spinner" /> {status || '思考中...'}
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
          {error && (
            <div className="card mt-4" style={{ borderColor: 'var(--error)', background: 'rgba(239,68,68,0.08)' }}>
              <div className="text-sm" style={{ color: 'var(--error)' }}>⚠ {error}</div>
              <div className="text-xs text-tertiary mt-2">
                免费通道可能限流（每分钟约 2 次），请稍等十几秒再发送；也可点击顶部"⚡ AI 测速"检查各通道状态。
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 8 }}>
          <textarea
            className="textarea"
            style={{ flex: 1, resize: 'none', minHeight: 44, maxHeight: 120, fontFamily: 'inherit' }}
            placeholder={loading ? 'AI 正在回复...' : '向 AI 助手提问（支持 Markdown，按 Enter 发送，Shift+Enter 换行）'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            disabled={loading}
          />
          {loading ? (
            <button className="btn btn-danger" onClick={handleStop}>停止</button>
          ) : (
            <button className="btn btn-primary" onClick={() => handleSend()} disabled={!input.trim()}>发送</button>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, streaming }) {
  const isUser = role === 'user'
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isUser ? 'var(--accent-dim)' : 'linear-gradient(135deg, var(--accent), #7c4dff)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isUser ? 'var(--accent)' : '#fff', fontSize: 14, fontWeight: 600,
      }}>
        {isUser ? '我' : '✨'}
      </div>
      <div style={{
        maxWidth: '80%', padding: '12px 16px', borderRadius: 12,
        background: isUser ? 'var(--accent-dim)' : 'var(--bg-card)',
        border: `1px solid ${isUser ? 'transparent' : 'var(--border-color)'}`,
        color: 'var(--text-primary)',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}{streaming && <span style={{ display: 'inline-block', width: 8, height: 16, background: 'var(--accent)', marginLeft: 4, animation: 'blink 1s infinite' }} />}
      </div>
      <style>{`@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }`}</style>
    </div>
  )
}

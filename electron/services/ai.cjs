// AI 助手服务
// 完全免费免密钥：多个内置免费通道（无需任何 API 密钥）自动轮换
// AI 测速：并发探测所有通道延迟，自动把最快的通道排到最前
const https = require('https')
const http = require('http')
const { logger } = require('./logger.cjs')

let _mainWindowGetter = null

// 内置免费通道（全部无需密钥），每个通道支持多个模型自动轮换
// 优先使用"非推理直答"模型（直接给答案，不会把 token 浪费在思考过程上）；推理模型作为备份
const FREE_CHANNELS = [
  {
    name: '免费通道 A',
    url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
    models: [
      'Meta-Llama-3_3-70B-Instruct',
      'Mistral-Small-3.2-24B-Instruct-2506',
      'Mistral-Nemo-Instruct-2407',
      'Mistral-7B-Instruct-v0.3',
      'gpt-oss-120b',
      'gpt-oss-20b',
      'Qwen3-32B',
    ],
  },
  {
    name: '免费通道 B',
    url: 'https://text.pollinations.ai/openai',
    models: [
      'openai',
      'mistral',
    ],
  },
]

const RATE_LIMIT_WAIT_MS = 15000 // 免费通道限流后的自动重试等待

// 当前活跃请求映射，用于取消
const _activeRequests = new Map()
let _lastErr = null

// 测速后的优先级排序：['通道url|模型', ...]，最优先的在前
let _speedRank = []

// 构建候选端点列表：全部来自免费通道，测速过的按延迟排序
function buildCandidates() {
  const candidates = []
  for (const ch of FREE_CHANNELS) {
    for (const m of ch.models) {
      candidates.push({ url: ch.url, key: '', model: m, source: ch.name, free: true })
    }
  }
  if (_speedRank.length) {
    const rankOf = (c) => {
      const i = _speedRank.indexOf(`${c.url}|${c.model}`)
      return i === -1 ? _speedRank.length : i
    }
    candidates.sort((a, b) => rankOf(a) - rankOf(b))
  }
  return candidates
}

// 去除 Qwen3 等模型的思考标签
function stripThink(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim()
}

// 单次请求（非流式），返回 { text, ms } 或抛出 { status, message }
function chatOnce(candidate, messages, opts) {
  return new Promise((resolve, reject) => {
    const url = new URL(candidate.url)
    const lib = url.protocol === 'https:' ? https : http
    const started = Date.now()

    const body = JSON.stringify({
      model: candidate.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens || 2048,
    })

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'nuo-agent-launcher/1.0',
    }
    if (candidate.key) headers['Authorization'] = `Bearer ${candidate.key}`

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      timeout: opts.timeout || 120000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        _activeRequests.delete(req)
        const text = Buffer.concat(chunks).toString()
        if (res.statusCode !== 200) {
          return reject({ status: res.statusCode, message: `HTTP ${res.statusCode}: ${text.slice(0, 200)}` })
        }
        try {
          const parsed = JSON.parse(text)
          const msg = parsed.choices?.[0]?.message?.content
            || parsed.choices?.[0]?.text
            || parsed.response || ''
          if (!msg) return reject({ status: 0, message: 'AI 返回了空内容' })
          const cleaned = stripThink(msg)
          if (!cleaned) {
            // 推理模型（gpt-oss/Qwen3）把额度全用在思考上了，切换下一个模型
            return reject({ status: 'EMPTY', message: '推理模型未给出正文（思考占用了全部额度）' })
          }
          resolve({ text: cleaned, ms: Date.now() - started })
        } catch (e) {
          reject({ status: 0, message: `响应解析失败: ${e.message}` })
        }
      })
    })
    req.on('timeout', () => { try { req.destroy(new Error('请求超时')) } catch {} })
    req.on('error', (e) => reject({ status: -1, message: e.message }))
    _activeRequests.set(req, req)
    req.write(body)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 取消标记：用户点击"停止"时置位，等待中的重试会中断
let _cancelFlag = false

// 主入口：按候选列表依次尝试；免费通道限流时自动排队等待重试，不向用户报错
async function chat(messages, opts = {}) {
  _cancelFlag = false
  const candidates = buildCandidates()
  let lastErr = null
  const backoffs = [12000, 18000, 25000] // 免费通道限流后的三次等待
  let rateRetries = 0

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci]
    try {
      logger.info('ai', `请求 ${candidate.source}`, { model: candidate.model, msgCount: messages.length })
      const result = await chatOnce(candidate, messages, opts)
      logger.info('ai', `对话完成`, { model: candidate.model, totalChars: result.text.length, ms: result.ms })
      pushStatus('')
      return { text: result.text, reqId: 'ai-direct', model: candidate.model, source: candidate.source }
    } catch (err) {
      lastErr = err
      const status = err?.status
      logger.info('ai', `候选失败`, { model: candidate.model, status, message: err?.message })

      // 免费通道限流（按 IP 计，换模型无用）：自动排队等待后重试同一模型
      if (status === 429 && candidate.free && rateRetries < backoffs.length) {
        const wait = backoffs[rateRetries]
        rateRetries++
        pushStatus(`免费通道较繁忙，正在排队等待（第 ${rateRetries} 次，约 ${Math.round(wait / 1000)} 秒）...`)
        logger.info('ai', `免费通道限流，${wait / 1000}s 后重试`)
        // 分段等待以便"停止"能及时中断
        for (let waited = 0; waited < wait; waited += 1000) {
          if (_cancelFlag) throw new Error('已取消')
          await sleep(1000)
        }
        ci-- // 重试同一个候选
        continue
      }
      // 其余错误：切换下一个模型
    }
  }

  pushStatus('')
  const msg = lastErr?.message || '未知错误'
  throw new Error(`免费通道暂时无法响应（${msg}）。请稍后重试，或点击"AI 测速"检查各通道状态。`)
}

// AI 测速：并发探测各通道（每通道取前 2 个模型），返回延迟排名并自动优先生效
async function speedTest() {
  const targets = []
  for (const ch of FREE_CHANNELS) {
    for (const m of ch.models.slice(0, 2)) {
      targets.push({ url: ch.url, key: '', model: m, source: ch.name, free: true })
    }
  }
  pushStatus('正在测速...')
  const results = await Promise.all(targets.map(async (t) => {
    const started = Date.now()
    try {
      await chatOnce(t, [{ role: 'user', content: 'hi' }], { maxTokens: 16, temperature: 0, timeout: 30000 })
      return { source: t.source, model: t.model, ok: true, latencyMs: Date.now() - started }
    } catch (e) {
      _lastErr = e
      return { source: t.source, model: t.model, ok: false, latencyMs: Date.now() - started, error: e?.message || String(e) }
    }
  }))
  pushStatus('')

  // 按延迟排序成功项，写入全局优先级
  const okSorted = results.filter((r) => r.ok).sort((a, b) => a.latencyMs - b.latencyMs)
  _speedRank = okSorted.map((r) => `${targets.find((t) => t.model === r.model && t.source === r.source).url}|${r.model}`)
  logger.info('ai', '测速完成', { fastest: okSorted[0]?.model, ok: okSorted.length, total: results.length })

  return {
    success: okSorted.length > 0,
    results: results.sort((a, b) => (b.ok - a.ok) || (a.latencyMs - b.latencyMs)),
    fastest: okSorted[0] || null,
  }
}

function cancel() {
  _cancelFlag = true
  for (const [, req] of _activeRequests) {
    try { req.destroy() } catch {}
  }
  _activeRequests.clear()
  pushStatus('')
  return true
}

function pushChunk(reqId, text) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('ai:chunk', { reqId, text }) } catch {}
  }
}
function pushDone(reqId, fullText) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('ai:done', { reqId, fullText }) } catch {}
  }
  _activeRequests.delete(reqId)
}
function pushError(reqId, error) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('ai:error', { reqId, error }) } catch {}
  }
  _activeRequests.delete(reqId)
}
function pushStatus(status) {
  if (_mainWindowGetter && _mainWindowGetter()) {
    try { _mainWindowGetter().webContents.send('ai:status', { reqId: 'ai-direct', status }) } catch {}
  }
}

function register(ipcMain, getMainWindow) {
  _mainWindowGetter = getMainWindow
  // 包装 chat：把结果推送给渲染进程（保持与旧版前端协议一致）
  ipcMain.handle('ai:chat', async (_e, messages, opts) => {
    try {
      const result = await chat(messages, opts)
      pushChunk(result.reqId, result.text)
      pushDone(result.reqId, result.text)
      return { reqId: result.reqId }
    } catch (e) {
      pushError('ai-direct', e.message)
      throw e
    }
  })
  ipcMain.handle('ai:cancel', (_e, id) => cancel(id))
  ipcMain.handle('ai:speed-test', () => speedTest())
}

module.exports = { register, chat, speedTest }

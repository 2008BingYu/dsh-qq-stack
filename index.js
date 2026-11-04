import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import { readFileSync as rf } from 'node:fs'

export const name = 'dsh-qq-stack'
export const inject = ['webServer']

const SELF = new URL('.', import.meta.url).pathname
const DEFAULTS = { root: '/root/qq-bot', uin: '', wsPort: 3001, token: '' }

function cfgDir(root) { return `${root}/opt/opt/QQ/resources/app/app_launcher/napcat/config` }

function ensureOnebot(root, port, token) {
  let changed = false
  let files = []
  try { files = readdirSync(cfgDir(root)) } catch { return false }
  for (const f of files) {
    if (!/^onebot11_\d{5,12}\.json$/.test(f)) continue
    const p = `${cfgDir(root)}/${f}`
    let cfg
    try { cfg = JSON.parse(readFileSync(p, 'utf8')) } catch { cfg = {} }
    cfg.network = cfg.network || {}
    const list = Array.isArray(cfg.network.websocketServers) ? cfg.network.websocketServers : []
    if (list.some((x) => Number(x.port) === Number(port) && x.enable !== false)) continue
    cfg.network.websocketServers = [{
      name: 'dsh', enable: true, host: '127.0.0.1', port: Number(port),
      messagePostFormat: 'array', reportSelfMessage: false, token,
      debug: false, heartInterval: 30000, enableForcePushEvent: true,
    }]
    try { writeFileSync(p, JSON.stringify(cfg, null, 2)); changed = true } catch {}
  }
  return changed
}

function sessionLoginUin(root) {
  let pidAt = 0
  try { pidAt = statSync(`${root}/qq.pid`).mtimeMs } catch {}
  let best = '', bestAt = 0
  try {
    for (const f of readdirSync(cfgDir(root))) {
      const m = f.match(/^napcat_(\d{5,12})\.json$/)
      if (!m) continue
      const at = statSync(`${cfgDir(root)}/${f}`).mtimeMs
      if (at >= pidAt && at > bestAt) { bestAt = at; best = m[1] }
    }
  } catch {}
  return best
}

let lastHealAt = 0

function readEnvFile(root) {
  const out = {}
  try {
    for (const line of readFileSync(`${root}/config.env`, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return out
}

function resolveConfig(config = {}) {
  const root = config.root || process.env.DSH_QQ_ROOT || DEFAULTS.root
  const file = readEnvFile(root)
  const pick = (a, b, c) => (a !== undefined && a !== '' ? a : b !== undefined && b !== '' ? b : c)
  return {
    root,
    uin: String(pick(config.uin, process.env.DSH_QQ_UIN, file.DSH_QQ_UIN ?? DEFAULTS.uin)),
    wsPort: Number(pick(config.wsPort, process.env.DSH_QQ_WS_PORT, file.DSH_QQ_WS_PORT ?? DEFAULTS.wsPort)),
    token: String(pick(config.token, process.env.DSH_QQ_TOKEN, file.DSH_QQ_TOKEN ?? DEFAULTS.token)),
    autoInstall: config.autoInstall ?? true,
  }
}

let probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
async function probeLogin(port, token, force) {
  if (!force && Date.now() - probeCache.at < 15000) return probeCache
  const result = await new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      const url = `ws://127.0.0.1:${port}/${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
      const ws = new WebSocket(url)
      const timer = setTimeout(() => { try { ws.close() } catch {}; finish({ loggedIn: false, nickname: '' }) }, 3000)
      ws.onopen = () => ws.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'probe' }))
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.echo === 'probe') {
            clearTimeout(timer)
            const ok = d.retcode === 0 && d.data && d.data.user_id
            try { ws.close() } catch {}
            finish({ loggedIn: !!ok, nickname: ok ? String(d.data.nickname || '') : '', uin: ok ? String(d.data.user_id || '') : '' })
          }
        } catch {}
      }
      ws.onerror = () => { clearTimeout(timer); finish({ loggedIn: false, nickname: '' }) }
    } catch { finish({ loggedIn: false, nickname: '' }) }
  })
  probeCache = { at: Date.now(), ...result }
  return probeCache
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export function apply(ctx, pluginConfig = {}) {
  try { return applyInner(ctx, pluginConfig) } catch (e) { try { ctx.logger?.warn?.(`[qq-stack] 激活失败：${e?.message ?? e}`) } catch {} }
}

function applyInner(ctx, pluginConfig = {}) {
  const cfg = resolveConfig(pluginConfig)
  const log = (msg) => { try { ctx.logger?.info?.(msg); if (process.env.DSH_QQ_DEBUG) console.log(msg) } catch {} }
  log(`[qq-stack] 激活 root=${cfg.root} uin=${cfg.uin || '(空)'} autoInstall=${cfg.autoInstall}`)

  const env = {
    ...process.env,
    DSH_QQ_ROOT: cfg.root,
    DSH_QQ_UIN: cfg.uin,
    DSH_QQ_WS_PORT: String(cfg.wsPort),
    DSH_QQ_TOKEN: cfg.token,
  }

  const ensureStarted = () => {
    try {
      let pid = 0
      try { pid = Number(readFileSync(`${cfg.root}/qq.pid`, 'utf8').trim()) || 0 } catch {}
      if (alive(pid)) return
      const script = `${cfg.root}/start-qq.sh`
      if (!existsSync(script)) return
      const child = spawn('bash', [script], { cwd: cfg.root, detached: true, stdio: 'ignore', env })
      child.unref()
      log('[qq-stack] 拉起 QQ')
    } catch (e) { log(`[qq-stack] 启动失败：${e?.message ?? e}`) }
  }

  const ensureInstalled = () => {
    if (existsSync(`${cfg.root}/opt/opt/QQ/qq`)) return ensureStarted()
    if (!cfg.autoInstall) { log('[qq-stack] 未安装且 autoInstall=false，跳过'); return }
    const installer = existsSync(`${cfg.root}/install.sh`) ? `${cfg.root}/install.sh` : `${SELF}install.sh`
    if (!existsSync(installer)) { log('[qq-stack] 找不到 install.sh'); return }
    log('[qq-stack] 首次安装开始（LinuxQQ + NapCat，约 250MB）')
    try {
      const child = spawn('bash', [installer], { cwd: cfg.root, detached: true, stdio: 'ignore', env })
      child.unref()
    } catch (e) { log(`[qq-stack] 安装启动失败：${e?.message ?? e}`) }
  }

  ctx.effect(() => {
    const timer = setInterval(async () => {
      try {
        const envFile = readEnvFile(cfg.root)
        const port = Number(envFile.DSH_QQ_WS_PORT || cfg.wsPort || 3001)
        const token = envFile.DSH_QQ_TOKEN || cfg.token
        const login = await probeLogin(port, token, true)
        if (login.loggedIn && login.uin && envFile.DSH_QQ_UIN !== login.uin) {
          const next = { ...envFile, DSH_QQ_UIN: login.uin }
          writeFileSync(`${cfg.root}/config.env`, Object.entries(next).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
          log(`[qq-stack] 记住快登号 ${login.uin}`)
        }
        const healed = ensureOnebot(cfg.root, port, token)
        if (healed && Date.now() - lastHealAt > 90000) {
          lastHealAt = Date.now()
          log('[qq-stack] 补齐 OneBot 配置，重启 QQ')
          try { spawn('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' }).unref() } catch {}
        }
      } catch (e) { log(`[qq-stack] 巡检失败：${e?.message ?? e}`) }
    }, 60000)
    return () => clearInterval(timer)
  }, 'dsh-qq-stack: config-check')

  ctx.effect(() => {
    const t = setTimeout(() => { try { ensureInstalled() } catch (e) { log(`[qq-stack] ${e?.message ?? e}`) } }, 8000)
    return () => clearTimeout(t)
  }, 'dsh-qq-stack: autostart')

  try {
    const API = '/api/plugins/qq-stack'
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const p = url.pathname.replace(API, '') || '/'
        const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
        if (req.method === 'GET' && (p === '/status' || p === '/')) {
          const envFile = readEnvFile(cfg.root)
          let qq = false
          try { qq = alive(Number(readFileSync(`${cfg.root}/qq.pid`, 'utf8').trim())) } catch {}
          let detectedUin = ''
          try {
            const dir = `${cfg.root}/opt/opt/QQ/resources/app/app_launcher/napcat/config`
            for (const f of readdirSync(dir)) {
              const m = f.match(/^onebot11_(\d{5,12})\.json$/)
              if (m) { detectedUin = m[1]; break }
            }
          } catch {}
          const qr = `${cfg.root}/opt/opt/QQ/resources/app/app_launcher/napcat/cache/qrcode.png`
          let qrAt = 0
          try {
            const qrM = statSync(qr).mtimeMs
            const pidM = statSync(`${cfg.root}/qq.pid`).mtimeMs
            if (qrM >= pidM) qrAt = Math.floor(qrM)
          } catch {}
          const login = qq ? await probeLogin(Number(envFile.DSH_QQ_WS_PORT || cfg.wsPort || 3001), envFile.DSH_QQ_TOKEN || cfg.token) : { loggedIn: false, nickname: '' }
          if (login.loggedIn) {
            const qqUin = detectedUin || envFile.DSH_QQ_UIN || ''
            if (qqUin && envFile.DSH_QQ_UIN !== qqUin) {
              const env2 = { ...envFile, DSH_QQ_UIN: qqUin }
              writeFileSync(`${cfg.root}/config.env`, Object.entries(env2).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
            }
          }
          const portNum = Number(envFile.DSH_QQ_WS_PORT || cfg.wsPort || 3001)
          const tokenVal = envFile.DSH_QQ_TOKEN || cfg.token
          const healed = ensureOnebot(cfg.root, portNum, tokenVal)
          if (healed && !login.loggedIn && Date.now() - lastHealAt > 90000) {
            lastHealAt = Date.now()
            try { spawn('bash', ['-c', `bash stop-qq.sh; bash start-qq.sh`], { cwd: cfg.root, detached: true, stdio: 'ignore' }).unref() } catch {}
          }
          const probeFresh = Date.now() - (probeCache.at || 0) < 6000
          if (login.loggedIn && login.uin && probeFresh && envFile.DSH_QQ_UIN !== login.uin) {
            try {
              const e2 = { ...envFile, DSH_QQ_UIN: login.uin }
              writeFileSync(`${cfg.root}/config.env`, Object.entries(e2).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
            } catch {}
          }
          return json({ ok: true, qq, loggedIn: !!login.loggedIn, nickname: login.nickname, uin: login.loggedIn ? login.uin : (envFile.DSH_QQ_UIN || detectedUin), port: envFile.DSH_QQ_WS_PORT || '3001', token: envFile.DSH_QQ_TOKEN || '', qrAt })
        }
        if (req.method === 'GET' && p === '/qr.png') {
          let detectedUin = ''
          try {
            const dir = `${cfg.root}/opt/opt/QQ/resources/app/app_launcher/napcat/config`
            for (const f of readdirSync(dir)) {
              const m = f.match(/^onebot11_(\d{5,12})\.json$/)
              if (m) { detectedUin = m[1]; break }
            }
          } catch {}
          const qr = `${cfg.root}/opt/opt/QQ/resources/app/app_launcher/napcat/cache/qrcode.png`
          if (!existsSync(qr)) { res.writeHead(404); return res.end() }
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
          return res.end(rf(qr))
        }
        if (req.method === 'POST' && p === '/save') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            try {
              const v = JSON.parse(body || '{}')
              const allow = {}
              for (const k of ['DSH_QQ_UIN', 'DSH_QQ_WS_PORT', 'DSH_QQ_TOKEN']) {
                if (typeof v[k] === 'string') allow[k] = v[k].replace(/[\r\n]/g, '')
              }
              const cur = readEnvFile(cfg.root)
              const next = { ...cur, ...allow }
              writeFileSync(`${cfg.root}/config.env`, Object.entries(next).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
              return json({ ok: true })
            } catch (e) { return json({ ok: false, error: String(e?.message ?? e) }, 400) }
          })
          return
        }
        if (req.method === 'POST' && p === '/logout') {
          try {
            const cur = readEnvFile(cfg.root)
            const next = { ...cur, DSH_QQ_UIN: '' }
            delete next.DSH_QQ_PASSWORD_MD5
            writeFileSync(`${cfg.root}/config.env`, Object.entries(next).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
          } catch {}
          try {
            const auth = `${cfg.root}/data/qq-home/.config/QQ/auth/login.enc`
            if (existsSync(auth)) unlinkSync(auth)
          } catch {}
          probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
          try { spawn('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' }).unref() } catch {}
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/restart') {
          try { spawn('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' }).unref() } catch {}
          return json({ ok: true })
        }
        json({ ok: false }, 404)
      } catch (e) { try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0,3) })) } catch {} }
    }
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API, handler }), 'dsh-qq-stack: api')
  } catch (e) { log(`[qq-stack] 接口注册失败：${e?.message ?? e}`) }

}

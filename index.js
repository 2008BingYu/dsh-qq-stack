import { spawn } from 'node:child_process'
import net from 'node:net'
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync, mkdirSync, openSync } from 'node:fs'

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
let healing = false
async function probeLogin(port, token, force) {
  const ttl = probeCache.loggedIn ? 15000 : 3000
  if (!force && Date.now() - probeCache.at < ttl) return probeCache
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


function spawnSafe(cmd, args, opts) {
  try {
    const child = spawn(cmd, args, opts)
    child.on('error', () => {})
    child.unref()
    return child
  } catch { return null }
}

function portOpen(port, timeout = 400) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (v) => { if (!done) { done = true; try { sock.destroy() } catch {} resolve(v) } }
    sock.setTimeout(timeout, () => finish(false))
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
    try { sock.connect(port, '127.0.0.1') } catch { finish(false) }
  })
}

function ensureOnebotFor(root, uin, port, token) {
  if (!uin) return false
  try {
    mkdirSync(cfgDir(root), { recursive: true })
    const p = `${cfgDir(root)}/onebot11_${uin}.json`
    if (existsSync(p)) return false
    writeFileSync(p, JSON.stringify({
      network: {
        httpServers: [], httpSseServers: [], httpClients: [], websocketClients: [], plugins: [],
        websocketServers: [{
          name: 'dsh', enable: true, host: '127.0.0.1', port: Number(port),
          messagePostFormat: 'array', reportSelfMessage: false, token,
          debug: false, heartInterval: 30000, enableForcePushEvent: true,
        }],
      },
      musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false, imageDownloadProxy: '',
    }, null, 2))
    return true
  } catch { return false }
}

function detectAccount(root) {
  let pidAt = 0
  try { pidAt = statSync(`${root}/qq.pid`).mtimeMs } catch {}
  let best = ''
  let bestAt = 0
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

function scanState(root) {
  let raw = ''
  try {
    const txt = readFileSync(`${root}/logs/qq.log`, 'utf8')
    raw = txt.slice(-20000)
  } catch { return { scanned: false, confirmed: false } }
  const startIdx = raw.lastIndexOf('NapCat.Core Version')
  const tail = startIdx >= 0 ? raw.slice(startIdx) : raw
  const scanned = tail.includes('二维码已被扫描') || tail.includes('扫码成功')
  return { scanned, confirmed: false }
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
  try { mkdirSync(cfg.root, { recursive: true }) } catch {}
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
      try { ensureOnebotFor(cfg.root, cfg.uin, cfg.wsPort, cfg.token); ensureOnebot(cfg.root, cfg.wsPort, cfg.token) } catch {}
      const child = spawnSafe('bash', [script], { cwd: cfg.root, detached: true, stdio: 'ignore', env })
      log('[qq-stack] 拉起 QQ')
    } catch (e) { log(`[qq-stack] 启动失败：${e?.message ?? e}`) }
  }

  const ensureInstalled = () => {
    if (existsSync(`${cfg.root}/opt/opt/QQ/qq`) && existsSync(`${cfg.root}/start-qq.sh`)) return ensureStarted()
    try {
      const running = Number(readFileSync(`${cfg.root}/install.pid`, 'utf8').trim()) || 0
      if (running && alive(running)) { log('[qq-stack] 安装已在进行中，跳过'); return }
    } catch {}
    if (!cfg.autoInstall) { log('[qq-stack] 未安装且 autoInstall=false，跳过'); return }
    const installer = existsSync(`${cfg.root}/install.sh`) ? `${cfg.root}/install.sh` : `${SELF}install.sh`
    if (!existsSync(installer)) { log('[qq-stack] 找不到 install.sh'); return }
    log('[qq-stack] 首次安装开始（LinuxQQ + NapCat，约 250MB）')
    try {
      mkdirSync(`${cfg.root}/logs`, { recursive: true })
      const fd = openSync(`${cfg.root}/logs/install.log`, 'a')
      const child = spawnSafe('bash', [installer], { cwd: cfg.root, detached: true, stdio: ['ignore', fd, fd], env })
      if (child?.pid) { try { writeFileSync(`${cfg.root}/install.pid`, String(child.pid)) } catch {} }
    } catch (e) { log(`[qq-stack] 安装启动失败：${e?.message ?? e}`) }
  }


  ctx.effect(() => {
    const timer = setInterval(async () => {
      try {
        const envFile = readEnvFile(cfg.root)
        const port = Number(envFile.DSH_QQ_WS_PORT || cfg.wsPort || 3001)
        const token = envFile.DSH_QQ_TOKEN || cfg.token
        const login = await probeLogin(port, token, true)
        if (!login.loggedIn && !envFile.DSH_QQ_UIN) {
          const guess = detectAccount(cfg.root)
          if (guess) {
            writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: guess }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
            log(`[qq-stack] 从数据目录识别到账号 ${guess}`)
          }
        }
        if (login.loggedIn) healing = false
        if (!login.loggedIn && !healing) {
          const acct = detectAccount(cfg.root)
          if (acct) {
            if (!envFile.DSH_QQ_UIN) {
              try {
                writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: acct }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
                log(`[qq-stack] 记住账号 ${acct}`)
              } catch {}
            }
            const created = ensureOnebotFor(cfg.root, acct, port, token)
            const healed = ensureOnebot(cfg.root, port, token) || created
            if (healed) {
              healing = true
              log('[qq-stack] QQ 已登录但 OneBot 没起来，补配置并重启')
              spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
            }
          }
        }
        if (login.loggedIn && login.uin && envFile.DSH_QQ_UIN !== login.uin) {
          const next = { ...envFile, DSH_QQ_UIN: login.uin }
          writeFileSync(`${cfg.root}/config.env`, Object.entries(next).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
          log(`[qq-stack] 记住快登号 ${login.uin}`)
        }
      } catch (e) { log(`[qq-stack] 巡检失败：${e?.message ?? e}`) }
    }, 60000)
    return () => clearInterval(timer)
  }, 'dsh-qq-stack: config-check')

  ctx.effect(() => {
    const t = setTimeout(() => { try { ensureInstalled() } catch (e) { log(`[qq-stack] ${e?.message ?? e}`) } }, 2000)
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
          let qrAge = 0
          try {
            const qrM = statSync(qr).mtimeMs
            const pidM = statSync(`${cfg.root}/qq.pid`).mtimeMs
            if (qrM >= pidM) qrAt = Math.floor(qrM)
            qrAge = Math.max(0, Math.round((Date.now() - qrM) / 1000))
          } catch {}
          let installing = false
          try { installing = alive(Number(readFileSync(`${cfg.root}/install.pid`, 'utf8').trim())) } catch {}
          let installed = existsSync(`${cfg.root}/opt/opt/QQ/qq`) && existsSync(`${cfg.root}/start-qq.sh`)
          const installedBefore = existsSync(`${cfg.root}/.installed`)
          let installTail = ''
          let installLabel = ''
          let installPct = -1
          try {
            const raw = readFileSync(`${cfg.root}/logs/install.log`, 'utf8')
            const lines = raw.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean)
            const prog = [...lines].reverse().find((l) => l.startsWith('[progress]'))
            if (prog) {
              const m = prog.match(/\[progress\]\s+(.*?)\s+(\d+)%/)
              if (m) { installLabel = m[1]; installPct = Number(m[2]) }
              installTail = prog.slice(11).trim()
            } else {
              installTail = lines.slice(-1).join(' ').slice(-160)
            }
          } catch {}
          const wsUp = await portOpen(Number(envFile.DSH_QQ_WS_PORT || '3001'))
          const login = qq ? await probeLogin(Number(envFile.DSH_QQ_WS_PORT || cfg.wsPort || 3001), envFile.DSH_QQ_TOKEN || cfg.token, !probeCache.loggedIn) : { loggedIn: false, nickname: '' }
          const scan = qq && !login.loggedIn ? scanState(cfg.root) : { scanned: false }
          return json({ ok: true, qq, loggedIn: !!login.loggedIn, nickname: login.nickname, uin: login.loggedIn ? login.uin : (detectedUin || envFile.DSH_QQ_UIN || detectAccount(cfg.root)), installed, installedBefore, installing, scanned: !!scan.scanned, installTail, installLabel, installPct, wsUp, port: envFile.DSH_QQ_WS_PORT || '3001', token: envFile.DSH_QQ_TOKEN || '', qrAt, qrAge })
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
          return res.end(readFileSync(qr))
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
          spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
          return json({ ok: true })
        }
        if ((req.method === 'POST' || req.method === 'GET') && p === '/wipe') {
          try {
            spawnSafe('bash', ['-c', `bash "${cfg.root}/stop-qq.sh" 2>/dev/null; rm -rf "${cfg.root}"`], { detached: true, stdio: 'ignore' })
          } catch {}
          probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/install') {
          const installer = existsSync(`${cfg.root}/install.sh`) ? `${cfg.root}/install.sh` : `${SELF}install.sh`
          try {
            mkdirSync(`${cfg.root}/logs`, { recursive: true })
            const fd = openSync(`${cfg.root}/logs/install.log`, 'a')
            const child = spawnSafe('bash', [installer], { cwd: cfg.root, detached: true, stdio: ['ignore', fd, fd], env })
            if (child?.pid) { try { writeFileSync(`${cfg.root}/install.pid`, String(child.pid)) } catch {} }
          } catch {}
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/apply') {
          try {
            const envFile = readEnvFile(cfg.root)
            const guess = envFile.DSH_QQ_UIN || detectAccount(cfg.root)
            if (guess && envFile.DSH_QQ_UIN !== guess) {
              writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: guess }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
            }
            ensureOnebot(cfg.root, Number(envFile.DSH_QQ_WS_PORT || 3001), envFile.DSH_QQ_TOKEN || '')
          } catch {}
          try { spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' }) } catch {}
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/refresh-qr') {
          spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/restart') {
          spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
          return json({ ok: true })
        }
        json({ ok: false }, 404)
      } catch (e) { try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0,3) })) } catch {} }
    }
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API, handler }), 'dsh-qq-stack: api')
  } catch (e) { log(`[qq-stack] 接口注册失败：${e?.message ?? e}`) }

}

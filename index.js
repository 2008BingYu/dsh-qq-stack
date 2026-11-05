import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { existsSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync, readdirSync, unlinkSync, mkdirSync, openSync } from 'node:fs'

export const name = 'dsh-qq-stack'
export const inject = ['webServer']

const SELF = new URL('.', import.meta.url).pathname
const DEFAULTS = { root: '/root/qq-bot', uin: '', host: '127.0.0.1', wsPort: 3001, token: '' }

function pluginLog(root, msg) {
  try {
    const dir = `${root}/logs`
    mkdirSync(dir, { recursive: true })
    const file = `${dir}/plugin.log`
    try { if (statSync(file).size > 2 * 1024 * 1024) renameSync(file, `${file}.1`) } catch {}
    const line = String(msg)
      .replace(/access_token=[^&\s]+/g, 'access_token=***')
      .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"***"')
      .replace(/DSH_QQ_TOKEN=.*/g, 'DSH_QQ_TOKEN=***')
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

function cfgDir(root) { return `${root}/opt/opt/QQ/resources/app/app_launcher/napcat/config` }

function ensureOnebot(root, port, token, host = '127.0.0.1') {
  let changed = false
  let files = []
  try { files = readdirSync(cfgDir(root)) } catch { return false }
  for (const f of files) {
    if (!/^onebot11_[A-Za-z0-9_]*\.json$/.test(f)) continue
    const p = `${cfgDir(root)}/${f}`
    let cfg
    try { cfg = JSON.parse(readFileSync(p, 'utf8')) } catch { cfg = {} }
    cfg.network = cfg.network || {}
    const list = Array.isArray(cfg.network.websocketServers) ? cfg.network.websocketServers : []
    const hit = list.find((x) => Number(x.port) === Number(port) && x.enable !== false)
    if (hit) {
      const tokDiff = String(hit.token ?? '') !== String(token ?? '')
      const hostDiff = String(hit.host ?? '127.0.0.1') !== String(host ?? '127.0.0.1')
      if (tokDiff || hostDiff) {
        if (token) hit.token = String(token); else delete hit.token
        hit.host = String(host || '127.0.0.1')
        try { writeFileSync(p, JSON.stringify(cfg, null, 2)); changed = true } catch {}
      }
      continue
    }
    const entry = {
      name: 'dsh', enable: true, host, port: Number(port),
      messagePostFormat: 'array', reportSelfMessage: false,
      debug: false, heartInterval: 30000, enableForcePushEvent: true,
    }
    if (token) entry.token = String(token)
    cfg.network.websocketServers = [entry]
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
    host: String(pick(config.host, process.env.DSH_QQ_HOST, file.DSH_QQ_HOST ?? DEFAULTS.host)),
    wsPort: Number(pick(config.wsPort, process.env.DSH_QQ_WS_PORT, file.DSH_QQ_WS_PORT ?? DEFAULTS.wsPort)),
    token: String(pick(config.token, process.env.DSH_QQ_TOKEN, file.DSH_QQ_TOKEN ?? DEFAULTS.token)),
    autoInstall: config.autoInstall ?? true,
  }
}

let probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
let activeRoot = ''
let applying = false
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
  const prevLogged = probeCache.loggedIn
  probeCache = { at: Date.now(), ...result }
  if (!!result.loggedIn !== !!prevLogged) {
    pluginLog(activeRoot, `probe loggedIn=${!!result.loggedIn}${result.uin ? ` uin=${result.uin}` : ''}${result.nickname ? ` nick=${result.nickname}` : ''}`)
  }
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

function ensureOnebotFor(root, uin, port, token, host = '127.0.0.1') {
  if (!uin) return false
  try {
    mkdirSync(cfgDir(root), { recursive: true })
    const p = `${cfgDir(root)}/onebot11_${uin}.json`
    if (existsSync(p)) return false
    writeFileSync(p, JSON.stringify({
      network: {
        httpServers: [], httpSseServers: [], httpClients: [], websocketClients: [], plugins: [],
        websocketServers: [{
          name: 'dsh', enable: true, host, port: Number(port),
          messagePostFormat: 'array', reportSelfMessage: false,
          debug: false, heartInterval: 30000, enableForcePushEvent: true,
          ...(token ? { token: String(token) } : {}),
        }],
      },
      musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false, imageDownloadProxy: '',
    }, null, 2))
    return true
  } catch { return false }
}

function detectAccount(root) {
  let best = ''
  let bestAt = 0
  try {
    const dir = `${root}/data/qq-home/.config/QQ/global/nt_data/Login`
    for (const f of readdirSync(dir)) {
      const m = f.match(/^\.?(\d{5,12})$/)
      if (!m) continue
      const at = statSync(`${dir}/${f}`).mtimeMs
      if (at > bestAt) { bestAt = at; best = m[1] }
    }
  } catch {}
  return best
}

function qrToken(root) {
  try {
    const txt = readFileSync(`${root}/logs/qq.log`, 'utf8').slice(-20000)
    const m = [...txt.matchAll(/txz\.qq\.com\/p\?k=([A-Za-z0-9*_-]+)/g)]
    if (!m.length) return ''
    return m[m.length - 1][1].slice(0, 24)
  } catch { return '' }
}

function scanState(root) {
  let raw = ''
  try {
    const txt = readFileSync(`${root}/logs/qq.log`, 'utf8')
    raw = txt.slice(-60000)
  } catch { return { scanned: false, confirmed: false } }
  let startIdx = raw.lastIndexOf('[qq-stack] start')
  if (startIdx < 0) startIdx = raw.lastIndexOf('NapCat.Core Version')
  const tail = startIdx >= 0 ? raw.slice(startIdx) : raw
  let error = ''
  const em = tail.match(/Login Error[^\n]*/)
  if (em) {
    const msg = em[0].match(/"message":"([^"]+)"/)
    const code = em[0].match(/ErrCode[^\d]*(\d+)/)
    error = msg ? msg[1] : `登录失败（错误码 ${code ? code[1] : '未知'}）`
  }
  const scanned = tail.includes('二维码已被扫描') || tail.includes('扫码成功')
  const authorized = scanned && (tail.includes('已加载 2 个适配器') || tail.includes('登录成功'))
  return { scanned, authorized, error }
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
  activeRoot = cfg.root
  try { mkdirSync(cfg.root, { recursive: true }) } catch {}
  const log = (msg) => { try { ctx.logger?.info?.(msg); if (process.env.DSH_QQ_DEBUG) console.log(msg) } catch {} }
  log(`[qq-stack] 激活 root=${cfg.root} uin=${cfg.uin || '(空)'} autoInstall=${cfg.autoInstall}`)

  const env = {
    ...process.env,
    DSH_QQ_ROOT: cfg.root,
    DSH_QQ_UIN: cfg.uin,
    DSH_QQ_HOST: cfg.host,
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
      try { ensureOnebotFor(cfg.root, cfg.uin, cfg.wsPort, cfg.token, cfg.host); ensureOnebot(cfg.root, cfg.wsPort, cfg.token, cfg.host) } catch {}
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
        const scan = scanState(cfg.root)

        if (scan.scanned && !login.loggedIn) {
          const acct = detectAccount(cfg.root)
          if (acct) ensureOnebotFor(cfg.root, acct, port, token, envFile.DSH_QQ_HOST || '127.0.0.1')
        }
        if (login.loggedIn) applying = false
        if (!login.loggedIn && !applying && scan.authorized) {
          const acct = detectAccount(cfg.root)
          if (acct) {
            // QQ 把登录凭证写进这个文件，存在即表示登录已落盘
            const cred = `${cfg.root}/data/qq-home/.config/QQ/global/nt_data/Login/.${acct}`
            let credAt = 0
            let pidAt = 0
            try { credAt = statSync(cred).mtimeMs } catch {}
            try { pidAt = statSync(`${cfg.root}/qq.pid`).mtimeMs } catch {}
            if (credAt && credAt >= pidAt) {
              if (!envFile.DSH_QQ_UIN) {
                try { writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: acct }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n') } catch {}
              }
              const created = ensureOnebotFor(cfg.root, acct, port, token, envFile.DSH_QQ_HOST || '127.0.0.1')
              const filled = ensureOnebot(cfg.root, port, token, envFile.DSH_QQ_HOST || '127.0.0.1') || created
              if (filled) {
                applying = true
                log('[qq-stack] 登录已落盘，应用 OneBot 配置并重启一次')
                spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
              }
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
    let lastStatusSig = ''
    const handler = async (req, res) => {
      const t0 = Date.now()
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const p = url.pathname.replace(API, '') || '/'
        const route = `${req.method} ${p}`
        const json = (o, code = 200, note = '') => {
          if (p !== '/status' && p !== '/' && p !== '/qr.png') {
            pluginLog(cfg.root, `← ${route} ${code} ${Date.now() - t0}ms${note ? ` ${note}` : ''} ${JSON.stringify(o).slice(0, 160)}`)
          }
          res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o))
        }
        if (p !== '/status' && p !== '/' && p !== '/qr.png') pluginLog(cfg.root, `→ ${route}`)
        if (req.method === 'GET' && (p === '/status' || p === '/')) {
          const envFile = readEnvFile(cfg.root)
          let qq = false
          try { qq = alive(Number(readFileSync(`${cfg.root}/qq.pid`, 'utf8').trim())) } catch {}
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
          let installStep = ''
          let measurePct = -1
          let linuxqqDone = existsSync(`${cfg.root}/opt/opt/QQ/qq`)
          let napcatDone = existsSync(`${cfg.root}/opt/opt/QQ/resources/app/app_launcher/napcat/napcat.mjs`)
          try {
            const raw = readFileSync(`${cfg.root}/logs/install.log`, 'utf8')
            const lines = raw.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean)
            const stepLine = [...lines].reverse().find((l) => l.startsWith('[step] '))
            if (stepLine) installStep = stepLine.slice(7).trim()
            const mline = [...lines].reverse().find((l) => /\[progress\]\s+测速\s+\d+\/\d+/.test(l))
            if (mline) {
              const mm = mline.match(/测速\s+(\d+)\/(\d+)/)
              if (mm) measurePct = Math.round((Number(mm[1]) / Number(mm[2])) * 100)
            }
            const prog = [...lines].reverse().find((l) => l.startsWith('[progress]') && !l.includes('测速'))
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
          const scan = qq && !login.loggedIn ? scanState(cfg.root) : { scanned: false, authorized: false, error: '' }
          if (login.loggedIn) applying = false
          if (scan.scanned && !scan.authorized) applying = false
          const inScanFlow = scan.scanned && !scan.authorized
          if (!login.loggedIn && !applying && !inScanFlow) {
            const acct = detectAccount(cfg.root)
            if (acct) {
              let changed = false
              if (!envFile.DSH_QQ_UIN) {
                try { writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: acct }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n') } catch {}
              }
              try {
                changed = ensureOnebotFor(cfg.root, acct, Number(envFile.DSH_QQ_WS_PORT || 3001), envFile.DSH_QQ_TOKEN || '', envFile.DSH_QQ_HOST || '127.0.0.1')
                changed = ensureOnebot(cfg.root, Number(envFile.DSH_QQ_WS_PORT || 3001), envFile.DSH_QQ_TOKEN || '', envFile.DSH_QQ_HOST || '127.0.0.1') || changed
              } catch {}
              if (changed) {
                applying = true
                log('[qq-stack] 已登录但协议未启动，补配置并重启')
                spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
              }
            }
          }
          try {
            const sig = [qq ? 'qq' : '-', wsUp ? 'ws' : '-', login.loggedIn ? `login:${login.uin}` : 'nologin', scan.scanned ? 'scanned' : '-', scan.authorized ? 'auth' : '-', scan.error || '-', installing ? 'installing' : '-', installed ? 'installed' : 'notinstalled', envFile.DSH_QQ_UIN || '-'].join(' ')
            if (sig !== lastStatusSig) { lastStatusSig = sig; pluginLog(cfg.root, `status ${sig}`) }
          } catch (e) { pluginLog(cfg.root, `status sig 失败 ${e?.message ?? e}`) }
          return json({ ok: true, qq, loggedIn: !!login.loggedIn, nickname: login.nickname, uin: login.loggedIn ? login.uin : (envFile.DSH_QQ_UIN || detectAccount(cfg.root)), installed, installedBefore, installing, installStep, measurePct, linuxqqDone, napcatDone, scanned: !!scan.scanned, authorized: !!scan.authorized, needsApply: !login.loggedIn && !!detectAccount(cfg.root), loginError: scan.error || '', installTail, installLabel, installPct, wsUp, host: envFile.DSH_QQ_HOST || '127.0.0.1',
            port: envFile.DSH_QQ_WS_PORT || '3001', token: envFile.DSH_QQ_TOKEN || '', qrAt, qrAge, qrToken: qq && !login.loggedIn ? qrToken(cfg.root) : '' })
        }
        if (req.method === 'GET' && p === '/log') {
          try {
            const n = Math.max(10, Math.min(1000, Number(url.searchParams.get('n') || 200)))
            const txt = readFileSync(`${cfg.root}/logs/plugin.log`, 'utf8').split('\n').slice(-n).join('\n')
              .replace(/access_token=[^&\s]+/g, 'access_token=***')
              .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"***"')
              .replace(/DSH_QQ_TOKEN=.*/g, 'DSH_QQ_TOKEN=***')
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            return res.end(txt)
          } catch (e) { return json({ ok: false, error: String(e?.message ?? e) }, 500) }
        }
        if (req.method === 'GET' && p === '/qr.png') {
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
              for (const k of ['DSH_QQ_UIN', 'DSH_QQ_HOST', 'DSH_QQ_WS_PORT', 'DSH_QQ_TOKEN']) {
                if (typeof v[k] === 'string') allow[k] = v[k].replace(/[\r\n]/g, '')
              }
              const cur = readEnvFile(cfg.root)
              const next = { ...cur, ...allow }
              writeFileSync(`${cfg.root}/config.env`, Object.entries(next).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
              const changed = Object.keys(allow).map((k) => (k === 'DSH_QQ_TOKEN' ? `token=${allow[k] ? 'set' : 'empty'}` : `${k}=${allow[k]}`)).join(' ')
              pluginLog(cfg.root, `save ${changed || '(空)'}`)
              return json({ ok: true }, 200, changed)
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
          pluginLog(cfg.root, 'logout 开始：清账号 + 停 QQ')
          try { spawnSync('bash', [`${cfg.root}/stop-qq.sh`], { timeout: 60000 }) } catch {}
          try { spawnSync('bash', ['-c', `rm -rf "${cfg.root}/data/qq-home"`], { timeout: 60000 }); pluginLog(cfg.root, 'logout 已删除 data/qq-home') } catch {}
          try {
            for (const f of readdirSync(cfgDir(cfg.root))) {
              if (/^onebot11_\d{5,12}\.json$/.test(f)) {
                try { unlinkSync(`${cfgDir(cfg.root)}/${f}`) } catch {}
              }
            }
          } catch {}
          probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
          applying = false
          pluginLog(cfg.root, 'logout 完成，重新启动 QQ（应停在二维码）')
          try { spawnSafe('bash', [`${cfg.root}/start-qq.sh`], { cwd: cfg.root, detached: true, stdio: 'ignore', env }) } catch {}
          return json({ ok: true, loggedIn: false })
        }
        if ((req.method === 'POST' || req.method === 'GET') && p === '/wipe') {
          pluginLog(cfg.root, 'wipe 开始：停 QQ 并删除运行环境')
          try { spawnSync('bash', [`${cfg.root}/stop-qq.sh`], { timeout: 30000 }) } catch {}
          try { spawnSync('bash', ['-c', `rm -rf "${cfg.root}"`], { timeout: 120000 }) } catch {}
          probeCache = { at: 0, loggedIn: false, nickname: '', uin: '' }
          return json({ ok: true, installed: false })
        }
        if (req.method === 'POST' && p === '/install') {
          const installer = existsSync(`${cfg.root}/install.sh`) ? `${cfg.root}/install.sh` : `${SELF}install.sh`
          try {
            mkdirSync(`${cfg.root}/logs`, { recursive: true })
            const fd = openSync(`${cfg.root}/logs/install.log`, 'a')
            const child = spawnSafe('bash', [installer], { cwd: cfg.root, detached: true, stdio: ['ignore', fd, fd], env })
            if (child?.pid) { try { writeFileSync(`${cfg.root}/install.pid`, String(child.pid)) } catch {} }
            pluginLog(cfg.root, `install 已启动 pid=${child?.pid || '?'}`)
          } catch (e) { pluginLog(cfg.root, `install 启动失败 ${e?.message ?? e}`) }
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/apply') {
          try {
            const envFile = readEnvFile(cfg.root)
            const guess = envFile.DSH_QQ_UIN || detectAccount(cfg.root)
            if (guess && envFile.DSH_QQ_UIN !== guess) {
              writeFileSync(`${cfg.root}/config.env`, Object.entries({ ...envFile, DSH_QQ_UIN: guess }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n')
            }
            const changed = ensureOnebot(cfg.root, Number(envFile.DSH_QQ_WS_PORT || 3001), envFile.DSH_QQ_TOKEN || '', envFile.DSH_QQ_HOST || '127.0.0.1')
            if (!changed) { pluginLog(cfg.root, 'apply 无变化，不重启'); return json({ ok: true, restarted: false }) }
          } catch {}
          pluginLog(cfg.root, 'apply 有变化，重启 QQ')
          try { spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' }) } catch {}
          return json({ ok: true, restarted: true })
        }
        if (req.method === 'POST' && p === '/refresh-qr') {
          pluginLog(cfg.root, 'refresh-qr：重启 QQ 重新出码')
          spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
          return json({ ok: true })
        }
        if (req.method === 'POST' && p === '/restart') {
          pluginLog(cfg.root, 'restart：重启 QQ')
          spawnSafe('bash', ['-c', 'bash stop-qq.sh; bash start-qq.sh'], { cwd: cfg.root, detached: true, stdio: 'ignore' })
          return json({ ok: true })
        }
        json({ ok: false }, 404)
      } catch (e) { try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0,3) })) } catch {} }
    }
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API, handler }), 'dsh-qq-stack: api')
  } catch (e) { log(`[qq-stack] 接口注册失败：${e?.message ?? e}`) }

}

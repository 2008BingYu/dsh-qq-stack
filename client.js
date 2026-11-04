window.__ModuleLoader__.load({
  id: 'dsh-qq-stack',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react')
    const h = react.createElement
    const inject = ['slots']
    const API = '/api/plugins/qq-stack'

    async function api(method, path, body) {
      try {
        const r = await fetch(API + path, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return await r.json()
      } catch { return null }
    }

    const row = (label, ok, text) => h('div', { className: 'fs-row' },
      h('span', null, label),
      h('span', { className: 'fs-val' },
        h('i', { className: ok ? 'fs-dot fs-on' : 'fs-dot fs-off' }),
        text))

    const CSS = `
.fs-wrap{display:flex;flex-direction:column;gap:12px}
.fs-card{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:14px;padding:12px}
.fs-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px}
.fs-val{display:flex;align-items:center;gap:6px;opacity:.9}
.fs-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.fs-on{background:#39d98a}.fs-off{background:#ff5c5c}
.fs-center{display:flex;flex-direction:column;align-items:center;gap:8px}
.fs-qrbox{position:relative;display:flex;align-items:center;justify-content:center}
.fs-qrmask{position:absolute;inset:0;background:rgba(0,0,0,.72);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.fs-qrmask-title{color:#fff;font-size:16px;font-weight:600}
.fs-qrmask-text{color:rgba(255,255,255,.85);font-size:13px}
.fs-qr{width:min(62vw,240px);height:auto;border-radius:12px;background:#fff;padding:8px}
.fs-hint{font-size:12px;opacity:.6}
.fs-conn{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.fs-input{width:100%;box-sizing:border-box;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;border-radius:9px;padding:9px;font-size:14px}
.fs-btns{display:flex;gap:8px;margin-top:12px}
.fs-btn[disabled]{opacity:.55}
.fs-btn{flex:1;border:0;border-radius:9px;padding:10px;font-size:14px;background:#2f6fed;color:#fff}
.fs-ghost{background:rgba(127,127,127,.2);color:inherit}
.fs-account{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 12px}
.fs-avatar{width:72px;height:72px;border-radius:50%;background:rgba(127,127,127,.15);object-fit:cover}
.fs-name{font-size:16px;font-weight:600;margin-top:4px}
.fs-uin{font-size:12px;opacity:.55}
.fs-btn.fs-danger{margin-top:8px;color:#d93025;border-color:rgba(217,48,37,.35)}
.fs-tabs{display:flex;gap:6px;margin-bottom:10px}
.fs-tab{flex:1;padding:8px 0;border:none;border-radius:9px;background:rgba(127,127,127,.12);color:inherit;font-size:13px;opacity:.7}
.fs-tab-on{background:#12b7f5;color:#fff;opacity:1}
.fs-clean{display:block;width:100%;padding:14px;margin-top:2px;border:none;border-radius:12px;background:rgba(127,127,127,.10);color:#c0392b;font-size:14px;font-weight:500}
.fs-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99;padding:32px}
.fs-dialog{background:#f7f7f8;color:#111;border-radius:16px;padding:20px 18px 14px;width:100%;max-width:290px;box-shadow:0 12px 40px rgba(0,0,0,.18)}
.fs-dialog-title{font-size:16px;font-weight:600;margin-bottom:10px}
.fs-dialog-text{font-size:13px;line-height:1.5;color:#666;margin-bottom:18px}
.fs-dialog-btns{display:flex;gap:10px}
.fs-dbtn{flex:1;padding:11px 0;border:none;border-radius:10px;font-size:14px;font-weight:500;background:rgba(127,127,127,.14);color:#333}
.fs-dbtn-danger{background:#e5484d;color:#fff}
@media (prefers-color-scheme: dark){
.fs-dialog{background:#2b2b2e;color:#f2f2f2}
.fs-dialog-text{color:#a8a8ad}
.fs-dbtn{background:rgba(255,255,255,.12);color:#f2f2f2}
}
.fs-btns-col{flex-direction:column;width:100%;margin-top:14px}
.fs-primary{background:#12b7f5}
.fs-login{display:flex;flex-direction:column;gap:10px}
.fs-field{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;padding:10px 2px;font-size:15px;outline:none}
.fs-wide{padding:11px}
.fs-sep{text-align:center;font-size:12px;opacity:.5;margin-top:6px}
.fs-install{font-size:14px;font-weight:600;margin-bottom:6px}
.fs-bar{height:6px;border-radius:3px;background:rgba(127,127,127,.2);overflow:hidden;margin:8px 0 6px}
.fs-bar-in{height:100%;background:#12b7f5;border-radius:3px;transition:width .4s}`

    function Panel() {
      const [st, setSt] = react.useState(null)
      const [busy, setBusy] = react.useState('')
      const [err, setErr] = react.useState(false)

      const load = async () => {
        const d = await api('GET', '/status')
        if (d?.ok) { setSt(d); setErr(false) } else setErr(true)
      }
      react.useEffect(() => { void load() }, [])
      react.useEffect(() => {
        const t = setInterval(load, st?.installing ? 1500 : 5000)
        return () => clearInterval(t)
      }, [st?.installing])

      const [askWipe, setAskWipe] = react.useState(false)
      const [tab, setTab] = react.useState('')
      const [editConn, setEditConn] = react.useState(false)
      const [portIn, setPortIn] = react.useState('')
      const [tokenIn, setTokenIn] = react.useState('')
      react.useEffect(() => {
        if (!editConn && st) { setPortIn(String(st.port || '3001')); setTokenIn(String(st.token || '')) }
      }, [st, editConn])
      const saveConn = async () => {
        setBusy('/save')
        await api('POST', '/save', { DSH_QQ_WS_PORT: portIn.trim() || '3001', DSH_QQ_TOKEN: tokenIn.trim() })
        await api('POST', '/apply')
        setBusy('')
        setEditConn(false)
        setTimeout(() => { void load() }, 1500)
      }
      const needApply = !!(st?.qq && st?.wsUp === false && !st?.installing && (st?.uin || st?.loggedIn))
      const post = async (path, body) => {
        setBusy(path)
        const r = await api('POST', path, body)
        if (path === '/wipe' && r && r.ok) {
          setSt({ ok: true, qq: false, wsUp: false, loggedIn: false, installed: false, installedBefore: false, installing: false, qrAt: 0 })
        }
        await new Promise((resolve) => setTimeout(resolve, 800))
        await load()
        setBusy('')
      }

      const applyFix = () => post('/apply')

      const qrKey = st?.qrToken || st?.qrAt || ''
      const qrUrl = qrKey ? `${API}/qr.png?t=${encodeURIComponent(qrKey)}` : `${API}/qr.png`
      const logged = !!st?.loggedIn
      const page = tab || (logged ? 'settings' : 'login')
      react.useEffect(() => { if (!st?.installed) setTab('') }, [st?.installed])

      return h('div', { className: 'fs-wrap' },
        h('style', null, CSS),
        err ? h('div', { className: 'fs-hint' }, '状态获取失败，稍后自动重试') : null,
        (st?.installed && !st?.installing && page === 'login') ? h('div', { className: 'fs-card' },
          row('QQ 进程', !!st?.qq, st?.qq ? '运行中' : '未运行'),
          row('OneBot 端口', !!st?.wsUp, st?.wsUp ? '已监听' : '未监听'),
          row('登录状态', logged, logged ? `已登录 ${st?.nickname || ''} ${st?.uin || ''}` : '未登录'),
        ) : null,
        (st?.installed && !st?.installing) ? h('div', { className: 'fs-tabs' },
          h('button', { className: 'fs-tab' + (page === 'login' ? ' fs-tab-on' : ''), onClick: () => setTab('login') }, '登录'),
          h('button', { className: 'fs-tab' + (page === 'settings' ? ' fs-tab-on' : ''), onClick: () => setTab('settings') }, '设置'),
        ) : null,
        (st?.installed && !st?.installing && page === 'login' && !logged) ? h('div', { className: 'fs-card fs-center' },
          h('div', { className: 'fs-qrbox' },
            st?.qrAt
              ? h('img', { className: 'fs-qr', src: qrUrl, alt: '登录二维码' })
              : h('div', { className: 'fs-hint' }, st?.authorized ? '已授权，正在登录…' : (st?.scanned ? '已扫码，等待手机确认…' : (st?.qq ? '正在准备二维码…' : 'QQ 正在启动…'))),
            (st?.qrAt && st?.scanned) ? h('div', { className: 'fs-qrmask' },
              h('div', { className: 'fs-qrmask-title' }, '已扫码'),
              h('div', { className: 'fs-qrmask-text' }, '请在手机上点「允许登录」'),
            ) : null,
          ),
          st?.qrAt ? h('div', { className: 'fs-hint' }, st?.scanned ? '确认后自动进入' : '用手机 QQ 扫码，并点允许登录') : (st?.authorized ? h('div', { className: 'fs-hint' }, '登录成功后会显示头像') : null),
        ) : null,
        (st && !st.installed && !st.installing) ? h('div', { className: 'fs-card' },
          h('div', { className: 'fs-install' }, st.installedBefore ? '上次安装没完成' : '还没安装'),
          h('div', { className: 'fs-hint' },
            st.installedBefore ? '可以直接重试，已经下好的部分会复用' : '首次安装约 250MB，需要几分钟'),
          h('div', { className: 'fs-btns' },
            h('button', { className: 'fs-btn fs-primary', disabled: busy === '/install', onClick: () => post('/install') },
              busy === '/install' ? '安装中…' : (st.installedBefore ? '重新安装' : '开始安装')),
          ),
        ) : null,
        (st?.installing) ? h('div', { className: 'fs-card' },
          h('div', { className: 'fs-install' },
            st.installing ? `正在安装 ${st.installLabel || 'QQ 运行环境'}…` : '运行环境未就绪'),
          (st.installPct >= 0) ? h('div', { className: 'fs-bar' },
            h('div', { className: 'fs-bar-in', style: { width: `${Math.max(2, Math.min(100, st.installPct))}%` } }),
          ) : null,
          h('div', { className: 'fs-hint' },
            st.installPct >= 0 ? `${st.installPct}%` : (st.installTail || '首次安装约 250MB，请稍候')),
        ) : null,
        (st?.installed && !st?.installing) ? h('div', { className: 'fs-card' },
          h('div', { className: 'fs-row', onClick: () => setEditConn(!editConn) },
            h('div', null, '连接设置'),
            h('div', { className: 'fs-hint' }, editConn ? '收起' : `${st.port} · ${st.token ? '有令牌' : '无令牌'}`),
          ),
          editConn ? h('div', { className: 'fs-conn' },
            h('div', { className: 'fs-hint' }, '端口'),
            h('input', { className: 'fs-input', value: portIn, onChange: (e) => setPortIn(e.target.value), inputMode: 'numeric', placeholder: '3001' }),
            h('div', { className: 'fs-hint' }, '令牌（留空表示不校验）'),
            h('input', { className: 'fs-input', value: tokenIn, onChange: (e) => setTokenIn(e.target.value), placeholder: '留空则不校验' }),
            h('div', { className: 'fs-btns' },
              h('button', { className: 'fs-btn fs-primary', onClick: saveConn }, busy === '/save' ? '保存中…' : '保存并重启 QQ'),
            ),
          ) : null,
        ) : null,
        (st?.installed && page === 'settings') ? h('button', { className: 'fs-clean', onClick: () => setAskWipe(true) }, '清理运行环境') : null,
        askWipe ? h('div', { className: 'fs-mask' },
          h('div', { className: 'fs-dialog' },
            h('div', { className: 'fs-dialog-title' }, '清理运行环境'),
            h('div', { className: 'fs-dialog-text' }, '会停掉 QQ，并删掉已下载的客户端和登录数据。下次需要重新扫码。'),
            h('div', { className: 'fs-dialog-btns' },
              h('button', { className: 'fs-dbtn', onClick: () => setAskWipe(false) }, '取消'),
              h('button', { className: 'fs-dbtn fs-dbtn-danger', onClick: () => { setAskWipe(false); void post('/wipe') } }, '清理'),
            ),
          ),
        ) : null,
        logged ? h('div', { className: 'fs-card fs-account' },
          h('img', {
            className: 'fs-avatar',
            src: st?.uin ? `https://q1.qlogo.cn/g?b=sdk&nk=${st.uin}&s=640` : '',
            alt: '',
          }),
          h('div', { className: 'fs-name' }, st?.nickname || '已登录'),
          h('div', { className: 'fs-uin' }, st?.uin ? `QQ ${st.uin}` : ''),
          h('div', { className: 'fs-btns fs-btns-col' },
            h('button', { className: 'fs-btn fs-primary', onClick: () => post('/logout') },
              busy === '/logout' ? '切换中…' : '切换账号'),
          ),
        ) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'qq-stack',
        order: 61,
        label: () => 'QQ 底座',
      }, Panel))
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
})

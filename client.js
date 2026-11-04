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
.fs-qr{width:min(62vw,240px);height:auto;border-radius:12px;background:#fff;padding:8px}
.fs-hint{font-size:12px;opacity:.6}
.fs-input{width:100%;box-sizing:border-box;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;border-radius:9px;padding:9px;font-size:14px}
.fs-btns{display:flex;gap:8px}
.fs-btn{flex:1;border:0;border-radius:9px;padding:10px;font-size:14px;background:#2f6fed;color:#fff}
.fs-ghost{background:rgba(127,127,127,.2);color:inherit}
.fs-account{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 12px}
.fs-avatar{width:72px;height:72px;border-radius:50%;background:rgba(127,127,127,.15);object-fit:cover}
.fs-name{font-size:16px;font-weight:600;margin-top:4px}
.fs-uin{font-size:12px;opacity:.55}
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

      const post = async (path, body) => {
        setBusy(path)
        await api('POST', path, body)
        setTimeout(() => { void load(); setBusy('') }, 8000)
      }

      const qrUrl = st?.qrAt ? `${API}/qr.png?t=${st.qrAt}` : `${API}/qr.png`
      const logged = !!st?.loggedIn

      return h('div', { className: 'fs-wrap' },
        h('style', null, CSS),
        err ? h('div', { className: 'fs-hint' }, '状态获取失败，稍后自动重试') : null,
        h('div', { className: 'fs-card' },
          row('QQ 进程', !!st?.qq, st?.qq ? '运行中' : '未运行'),
          row('OneBot 端口', !!st?.qq, st?.qq ? '已监听' : '未监听'),
          row('登录状态', logged, logged ? `已登录 ${st?.nickname || ''} ${st?.uin || ''}` : '未登录'),
        ),
        (st?.installed !== false && !st?.installing && !logged) ? h('div', { className: 'fs-card fs-center' },
          st?.qrAt
            ? h('img', { className: 'fs-qr', src: qrUrl, alt: '登录二维码' })
            : h('div', { className: 'fs-hint' }, '正在生成二维码…'),
        ) : null,
        (st && (!st.installed || st.installing)) ? h('div', { className: 'fs-card' },
          h('div', { className: 'fs-install' },
            st.installing ? `正在安装 ${st.installLabel || 'QQ 运行环境'}…` : '运行环境未就绪'),
          (st.installPct >= 0) ? h('div', { className: 'fs-bar' },
            h('div', { className: 'fs-bar-in', style: { width: `${Math.max(2, Math.min(100, st.installPct))}%` } }),
          ) : null,
          h('div', { className: 'fs-hint' },
            st.installPct >= 0 ? `${st.installPct}%` : (st.installTail || '首次安装约 250MB，请稍候')),
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

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const [profileDir, root] = process.argv.slice(2)
if (!profileDir || !root) process.exit(0)

const pkgDir = `${profileDir}/node_modules/dsh-qq-stack`
let goneSince = 0

const present = () => existsSync(`${pkgDir}/index.js`) || existsSync(`${pkgDir}/package.json`)

function cleanup() {
  try { spawnSync('bash', [`${root}/stop-qq.sh`], { timeout: 30000 }) } catch {}
  try { spawnSync('bash', ['-c', `rm -rf "${root}"`], { timeout: 120000 }) } catch {}
  try {
    const pids = spawnSync('bash', ['-c', "ps -eo pid=,comm= | awk '$2==\"Xvfb\"{print $1}'"], { encoding: 'utf8' }).stdout
    for (const p of String(pids).split(/\s+/).filter(Boolean)) { try { process.kill(Number(p), 'SIGKILL') } catch {} }
  } catch {}
}

setInterval(() => {
  if (present()) { goneSince = 0; return }
  if (!goneSince) { goneSince = Date.now(); return }
  if (Date.now() - goneSince > 60000) { cleanup(); process.exit(0) }
}, 20000)

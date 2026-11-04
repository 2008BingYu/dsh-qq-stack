import { existsSync, readFileSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'

const [pkgDir, root] = process.argv.slice(2)
if (!pkgDir || !root) process.exit(0)

const alive = (pid) => {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

function cleanup() {
  try { spawnSync('bash', [`${root}/stop-qq.sh`], { timeout: 30000 }) } catch {}
  try { spawnSync('bash', ['-c', `rm -rf "${root}"`], { timeout: 120000 }) } catch {}
  try {
    const pids = spawnSync('bash', ['-c', "ps -eo pid=,comm= | awk '$2==\"Xvfb\"{print $1}'"], { encoding: 'utf8' }).stdout
    for (const p of String(pids).split(/\s+/).filter(Boolean)) { try { process.kill(Number(p), 'SIGKILL') } catch {} }
  } catch {}
}

setInterval(() => {
  if (!existsSync(`${pkgDir}/package.json`)) { cleanup(); process.exit(0) }
}, 20000)

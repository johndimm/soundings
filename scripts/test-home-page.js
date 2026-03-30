const { spawn } = require('node:child_process')
const puppeteer = require('puppeteer')

const DEV_SERVER_CMD = ['run', 'dev', '--', '-H', '127.0.0.1', '-p', '8000']
const DEV_SERVER_READY_TIMEOUT_MS = 120_000
const HOME_URL = 'http://127.0.0.1:8000'

async function waitForDevServer(process) {
  let readyResolve
  let readyReject
  let ready = false

  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = () => {
      ready = true
      resolve()
    }
    readyReject = reject
  })

  const timeout = setTimeout(() => {
    if (!ready) {
      readyReject(new Error('Timed out waiting for dev server to start'))
      ready = true
    }
  }, DEV_SERVER_READY_TIMEOUT_MS)

  process.stdout?.on('data', chunk => {
    const text = chunk.toString()
    process.stdout.write(`[next] ${text}`)
    if (!ready && text.includes('Ready')) {
      clearTimeout(timeout)
      readyResolve()
    }
  })

  process.stderr?.on('data', chunk => {
    const text = chunk.toString()
    process.stderr.write(`[next err] ${text}`)
  })

  process.on('exit', code => {
    if (!ready) {
      readyReject(new Error(`Dev server exited early with code ${code}`))
    }
  })

  await readyPromise
}

async function runTest() {
  const dev = spawn('npm', DEV_SERVER_CMD, { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    await waitForDevServer(dev)

    if (process.env.TEST_SPOTIFY_TOKEN) {
      const testLoginRes = await fetch('http://127.0.0.1:8000/api/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: process.env.TEST_SPOTIFY_TOKEN,
          expires_in: Number(process.env.TEST_SPOTIFY_EXPIRES_IN ?? 3600),
        }),
      })
      if (!testLoginRes.ok) throw new Error('test login failed')
    }

    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    const consoleErrors = []

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 60_000 })
    await page.waitForTimeout(1500)
    await browser.close()

    if (consoleErrors.length > 0) {
      throw new Error(`Console errors detected:\n${consoleErrors.join('\n---\n')}`)
    }
  } finally {
    dev.kill('SIGINT')
    await new Promise(resolve => dev.once('exit', resolve))
  }
}

runTest().catch(err => {
  console.error(err)
  process.exit(1)
})

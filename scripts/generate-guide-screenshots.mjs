import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer'

const DEV_SERVER_CMD = ['run', 'dev', '--', '-H', '127.0.0.1', '-p', '8000']
const DEV_SERVER_READY_TIMEOUT_MS = 120_000
const BASE_URL = 'http://127.0.0.1:8000'
const OUTPUT_DIR = resolve(process.cwd(), 'public/guide/screenshots')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function serverIsReachable() {
  try {
    const response = await fetch(`${BASE_URL}/player?guide-demo=overview`)
    return response.ok
  } catch {
    return false
  }
}

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
    process.stderr.write(`[next err] ${chunk.toString()}`)
  })

  process.on('exit', code => {
    if (!ready) {
      readyReject(new Error(`Dev server exited early with code ${code}`))
    }
  })

  await readyPromise
}

async function openPage(browser, path, viewport) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => document.fonts?.status !== 'loading')
  await sleep(600)
  return page
}

async function captureElement(page, selector, outputName, options = {}) {
  const { padding = 16 } = options
  await page.waitForSelector(selector, { visible: true, timeout: 30_000 })
  await page.$eval(selector, element => {
    element.scrollIntoView({ block: 'center', inline: 'center' })
  })
  await sleep(250)

  const box = await page.$eval(selector, element => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  })

  const clip = {
    x: Math.max(0, Math.floor(box.x - padding)),
    y: Math.max(0, Math.floor(box.y - padding)),
    width: Math.ceil(box.width + padding * 2),
    height: Math.ceil(box.height + padding * 2),
  }

  await page.screenshot({
    path: resolve(OUTPUT_DIR, outputName),
    clip,
    captureBeyondViewport: true,
  })
  console.log(`saved ${outputName}`)
}

async function resizeImage(outputName, longEdge) {
  await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn('sips', ['-Z', String(longEdge), resolve(OUTPUT_DIR, outputName)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderr = ''
    proc.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    proc.on('exit', code => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(stderr || `sips failed for ${outputName}`))
    })
  })
}

async function run() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  let dev = null

  try {
    if (await serverIsReachable()) {
      console.log('using existing dev server')
    } else {
      dev = spawn('npm', DEV_SERVER_CMD, { stdio: ['ignore', 'pipe', 'pipe'] })
      await waitForDevServer(dev)
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    })

    try {
      const playerOverview = await openPage(browser, '/player?guide-demo=overview', {
        width: 1520,
        height: 1780,
        deviceScaleFactor: 2,
      })

      await playerOverview.screenshot({
        path: resolve(OUTPUT_DIR, 'full-player.png'),
      })
      console.log('saved full-player.png')

      await captureElement(playerOverview, '[data-guide="album-panel"]', 'album-indicator.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="track-info"]', 'track-info.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="grade-slider"]', 'rating-slider.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="sidebar"]', 'sidebar.png', { padding: 12 })
      await captureElement(playerOverview, '[data-guide="up-next"]', 'up-next.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="discovery"]', 'discovery-slider.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="genres"]', 'genre-chips.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="heard-item"]', 'heard-item.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="heard"]', 'heard-section.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="channels"]', 'channels.png', { padding: 10 })
      await captureElement(playerOverview, '[data-guide="discovery-queued"]', 'discovery-queued.png', { padding: 20 })
      await resizeImage('album-indicator.png', 600)
      await resizeImage('track-info.png', 304)
      await resizeImage('rating-slider.png', 247)
      await playerOverview.close()

      const playerStatus = await openPage(browser, '/player?guide-demo=status', {
        width: 1520,
        height: 1200,
        deviceScaleFactor: 2,
      })
      await captureElement(playerStatus, '[data-guide="status-banner"]', 'status-banner.png', { padding: 10 })
      await playerStatus.close()

      const mapPage = await openPage(browser, '/map?guide-demo=1', {
        width: 1160,
        height: 840,
        deviceScaleFactor: 2,
      })
      // Guide uses public/guide/screenshots/music-map.svg (illustration with green/red/grey dots).
      // await captureElement(mapPage, '[data-guide="music-map"]', 'music-map.png', { padding: 12 })
      await mapPage.close()
    } finally {
      await browser.close()
    }
  } finally {
    if (dev) {
      dev.kill('SIGINT')
      await new Promise(resolve => dev.once('exit', resolve))
    }
  }
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})

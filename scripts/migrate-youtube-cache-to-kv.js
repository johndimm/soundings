#!/usr/bin/env node
/**
 * Migrate YouTube cache from .youtube-cache.json to Vercel KV (Upstash)
 * Run locally: node scripts/migrate-youtube-cache-to-kv.js
 */

const fs = require('fs')
const path = require('path')

async function migrateCache() {
  // Load local cache file
  const cacheFile = path.join(process.cwd(), '.youtube-cache.json')
  let cacheData
  try {
    const content = fs.readFileSync(cacheFile, 'utf-8')
    cacheData = JSON.parse(content)
    console.log(`✓ Loaded ${Object.keys(cacheData).length} entries from .youtube-cache.json`)
  } catch (err) {
    console.error('✗ Failed to read cache file:', err.message)
    process.exit(1)
  }

  // Get KV credentials from env
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN

  if (!kvUrl || !kvToken) {
    console.error('✗ Missing KV credentials. Make sure KV_REST_API_URL and KV_REST_API_TOKEN are in .env.local')
    process.exit(1)
  }

  console.log(`✓ Using Vercel KV at ${kvUrl.replace(/https?:\/\//, '').split('.')[0]}...`)

  // Upload to KV via REST API
  try {
    const setUrl = new URL(kvUrl)
    setUrl.pathname = '/set/youtube-cache'

    const response = await fetch(setUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cacheData),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    const sizeKb = Math.round(JSON.stringify(cacheData).length / 1024)
    console.log(`✓ Uploaded ${Object.keys(cacheData).length} entries (${sizeKb}KB) to Vercel KV`)
  } catch (err) {
    console.error('✗ Failed to upload to KV:', err.message)
    process.exit(1)
  }

  // Verify
  try {
    const getUrl = new URL(kvUrl)
    getUrl.pathname = '/get/youtube-cache'

    const response = await fetch(getUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const result = data.result || data

    if (result && typeof result === 'object' && Object.keys(result).length > 0) {
      console.log(`✓ Verified: KV contains ${Object.keys(result).length} entries`)
      console.log('✓ Migration complete! Cache will be used by Vercel on next deploy.')
    } else {
      console.warn('⚠ Warning: KV read returned empty data')
    }
  } catch (err) {
    console.error('✗ Failed to verify:', err.message)
    process.exit(1)
  }
}

migrateCache()

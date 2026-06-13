#!/usr/bin/env node
/**
 * Migrate YouTube cache from .youtube-cache.json to Vercel KV
 * Run locally: npx ts-node scripts/migrate-youtube-cache-to-kv.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'

async function migrateCache() {
  const cacheFile = join(process.cwd(), '.youtube-cache.json')

  // Load local cache file
  let cacheData: Record<string, unknown>
  try {
    const content = readFileSync(cacheFile, 'utf-8')
    cacheData = JSON.parse(content)
    console.log(`✓ Loaded ${Object.keys(cacheData).length} entries from .youtube-cache.json`)
  } catch (err) {
    console.error('✗ Failed to read cache file:', err)
    process.exit(1)
  }

  // Connect to Vercel KV
  let kv: typeof import('@vercel/kv').kv
  try {
    const { kv: kvClient } = await import('@vercel/kv')
    kv = kvClient
    console.log('✓ Connected to Vercel KV')
  } catch (err) {
    console.error('✗ Failed to load Vercel KV. Make sure KV_REST_API_URL is in .env.local:', err)
    process.exit(1)
  }

  // Upload to KV
  try {
    await kv.set('youtube-cache', cacheData)
    const sizeKb = Math.round(JSON.stringify(cacheData).length / 1024)
    console.log(`✓ Uploaded ${Object.keys(cacheData).length} entries (${sizeKb}KB) to Vercel KV`)
  } catch (err) {
    console.error('✗ Failed to upload to KV:', err)
    process.exit(1)
  }

  // Verify
  try {
    const verify = await kv.get('youtube-cache')
    if (verify && typeof verify === 'object' && Object.keys(verify).length > 0) {
      console.log(`✓ Verified: KV contains ${Object.keys(verify).length} entries`)
      console.log('✓ Migration complete!')
    } else {
      console.warn('⚠ Warning: KV read returned empty data')
    }
  } catch (err) {
    console.error('✗ Failed to verify:', err)
    process.exit(1)
  }
}

migrateCache().catch(console.error)

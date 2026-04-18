/**
 * Local-only snapshot used on blank slate in development so you can iterate on default channels
 * without editing `demoChannel.ts` every time. Not used in production (`next build`).
 */
export const DEV_FACTORY_OVERRIDE_STORAGE_KEY = 'earprint-factory-dev-override'

/** True in `next dev`; false in production (`next build`). */
export function isNextDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

export function isDevFactorySnapshotEnabled(): boolean {
  return isNextDev()
}

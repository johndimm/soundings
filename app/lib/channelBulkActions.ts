import {
  deleteAllCustomChannels,
  EARPRINT_ALL_CHANNEL_ID,
  ensureAllChannel,
  type Channel,
} from '@/app/lib/channelsImportExport'

export { deleteAllCustomChannels, ensureAllChannel, EARPRINT_ALL_CHANNEL_ID }

/** Delete every channel whose id is in `ids` (All is never deleted). */
export function deleteChannelsByIds(channels: Channel[], ids: Iterable<string>): Channel[] {
  const drop = new Set(ids)
  drop.delete(EARPRINT_ALL_CHANNEL_ID)
  if (drop.size === 0) return ensureAllChannel(channels)
  const remaining = channels.filter(c => !drop.has(c.id))
  if (remaining.length === 0) return deleteAllCustomChannels(channels)
  return ensureAllChannel(remaining)
}

export function countCustomChannels(channels: readonly { id: string }[]): number {
  return channels.filter(c => c.id !== EARPRINT_ALL_CHANNEL_ID).length
}

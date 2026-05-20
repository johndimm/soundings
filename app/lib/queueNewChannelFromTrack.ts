import { NEW_CHANNEL_PREFILL_KEY } from '@/app/lib/channelEditorConfig'
import { trackToChannelSeeds } from '@/app/lib/trackToChannelSeeds'

/** Queue new-channel form prefill from a track, then open `/channels?new=1`. */
export function queueNewChannelFromTrack(
  track: string,
  artist: string,
  navigate: (path: string) => void,
  options?: { album?: string },
) {
  const { name, freeText, artists } = trackToChannelSeeds(track, artist, options)
  try {
    sessionStorage.setItem(
      NEW_CHANNEL_PREFILL_KEY,
      JSON.stringify({ v: 1, name, freeText, artists }),
    )
  } catch (e) {
    console.warn('[soundings] could not queue new channel from track', e)
  }
  navigate('/channels?new=1')
}

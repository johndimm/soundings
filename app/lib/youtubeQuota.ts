/** YouTube Data API v3 quota (credits). See Google Cloud quota table for each method. */
export const YOUTUBE_CREDITS_PER_SEARCH = 100
export const YOUTUBE_CREDITS_PER_VIDEOS_LIST = 1
export const YOUTUBE_DAILY_CREDITS = 110_000

/** @deprecated Use credits; kept for docs that speak in “searches”. */
export const YOUTUBE_DAILY_SEARCH_QUOTA =
  YOUTUBE_DAILY_CREDITS / YOUTUBE_CREDITS_PER_SEARCH

/** Warn in UI when fewer than ~5% of daily credits remain. */
export const YOUTUBE_LOW_CREDITS_THRESHOLD = 5_000

/** YouTube Data API v3 quota (credits). See Google Cloud quota table for each method. */
export const YOUTUBE_CREDITS_PER_SEARCH = 100
export const YOUTUBE_CREDITS_PER_VIDEOS_LIST = 1
// Special grant: 110,000 credits/day (ignore low Search Queries limit in quota table - that's a Google misconfiguration)
export const YOUTUBE_DAILY_CREDITS = 110_000

/** @deprecated Use credits; kept for docs that speak in “searches”. */
export const YOUTUBE_DAILY_SEARCH_QUOTA =
  YOUTUBE_DAILY_CREDITS / YOUTUBE_CREDITS_PER_SEARCH

/** Warn in UI when fewer than ~5% of daily credits remain (5% of 110,000 ≈ 5,500). */
export const YOUTUBE_LOW_CREDITS_THRESHOLD = 5_000

/** Warn in UI when fewer than 100 searches remain (Google's hard limit is 714 searches/day). */
export const YOUTUBE_LOW_SEARCHES_THRESHOLD = 100

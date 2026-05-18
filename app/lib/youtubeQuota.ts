/** YouTube Data API v3 quota (credits). Each search.list costs 100 credits. */
export const YOUTUBE_CREDITS_PER_SEARCH = 100
export const YOUTUBE_DAILY_CREDITS = 110_000
export const YOUTUBE_DAILY_SEARCH_QUOTA =
  YOUTUBE_DAILY_CREDITS / YOUTUBE_CREDITS_PER_SEARCH

/** Warn in UI when fewer than this many searches remain today (~5% of daily). */
export const YOUTUBE_LOW_SEARCHES_THRESHOLD = 50

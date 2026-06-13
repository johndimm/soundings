/** YouTube Data API v3 quota (credits). See Google Cloud quota table for each method. */
export const YOUTUBE_CREDITS_PER_SEARCH = 100
export const YOUTUBE_CREDITS_PER_VIDEOS_LIST = 1
// Daily limit: 714 Search Queries/day × 100 credits/search = 71,400 credits
// (Not the generic 110,000 Queries/day limit - that's for all API calls combined)
export const YOUTUBE_DAILY_CREDITS = 71_400

/** @deprecated Use credits; kept for docs that speak in “searches”. */
export const YOUTUBE_DAILY_SEARCH_QUOTA =
  YOUTUBE_DAILY_CREDITS / YOUTUBE_CREDITS_PER_SEARCH

/** Warn in UI when fewer than ~5% of daily credits remain (5% of 71,400 ≈ 3,570). */
export const YOUTUBE_LOW_CREDITS_THRESHOLD = 3_600

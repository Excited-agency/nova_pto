export const IMAGE_ALLOWED_TYPES = ["image/png", "image/jpeg"]
export const IMAGE_MAX_SIZE = 5 * 1024 * 1024 // 5 MB
export const AUTH_SAFETY_TIMEOUT = 10_000
export const INVITE_TIMEOUT_MS = 10_000
export const DEBOUNCE_DELAY_MS = 300
export const EMPLOYEES_PAGE_SIZE = 100
// Safety caps for potentially large, currently-unpaginated reads
export const TIME_OFF_REQUESTS_LIMIT = 1000
export const BALANCE_LOG_LIMIT = 500
/**
 * Holidays fetched per workspace. Must stay above any realistic count
 * (countries x years), because a truncated list makes the client's day
 * calculation under-exclude holidays relative to the server's, which has no
 * such limit. PostgREST would otherwise cap the response silently.
 */
export const HOLIDAYS_LIMIT = 2000
export const TOAST_DURATION_MS = 5000

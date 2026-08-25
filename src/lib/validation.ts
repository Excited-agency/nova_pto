/**
 * Single source of truth for email validation.
 *
 * Previously the CSV importer used this regex while the employee form used
 * Zod's built-in `.email()`. The two disagree on edge cases, so the same
 * address could be accepted when typed into the form yet rejected on CSV
 * import (or the reverse). Both now share this check.
 *
 * Requires a dot-separated TLD of at least two letters, which is what the
 * form's "e.g. name@company.com" hint promises.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim())
}

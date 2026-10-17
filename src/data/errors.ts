/** An error whose message is safe and meaningful to show to the user. */
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AppError'
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof AppError) return error.message
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'Network error — check your connection and try again.'
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

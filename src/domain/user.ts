export interface AppUser {
  id: string
  email: string
  displayName: string
}

export function initialsOf(user: AppUser): string {
  const source = user.displayName.trim() || user.email
  const parts = source.split(/[\s._@-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

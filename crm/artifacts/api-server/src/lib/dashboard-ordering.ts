export function newestFollowupsFirst<T extends { scheduledAt: Date; id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.scheduledAt.getTime() - a.scheduledAt.getTime() || b.id - a.id);
}

export function chronologicalMonths<T extends { year: number; monthNumber: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.year - b.year || a.monthNumber - b.monthNumber);
}
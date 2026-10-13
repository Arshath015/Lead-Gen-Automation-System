export function isStageTransition(previousId: number | null, nextId: number): boolean {
  return previousId !== nextId;
}

export function lostActivityMarker(isLost: boolean, stageName: string): string {
  return isLost ? "Lost" : stageName;
}
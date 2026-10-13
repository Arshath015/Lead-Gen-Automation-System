// Source-agnostic — every connector's own normalize() (see ISourceAdapter)
// calls into this with its own extracted email/companyDomain/fullName.
export function computeDedupKey(params: {
  source: string;
  sourceId: string;
  email: string | null;
  companyDomain: string | null;
  fullName: string;
}): string {
  if (params.email) return `email:${params.email.toLowerCase()}`;
  if (params.companyDomain && params.fullName) {
    return `namedomain:${params.fullName.toLowerCase()}:${params.companyDomain.toLowerCase()}`;
  }
  return `${params.source}:${params.sourceId}`;
}

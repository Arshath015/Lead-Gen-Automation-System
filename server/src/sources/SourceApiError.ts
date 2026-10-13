// Base error every connector's own API-error class extends (e.g.
// ApolloApiError in apollo.ts), so callers that need to react to "some
// provider's API rejected this request" — like the reveal-bulk credit-
// exhaustion short-circuit in leads.routes.ts — can check `instanceof
// SourceApiError` once, generically, instead of importing and naming every
// individual connector's error class.
export class SourceApiError extends Error {
  constructor(
    public readonly source: string,
    public readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "SourceApiError";
  }
}

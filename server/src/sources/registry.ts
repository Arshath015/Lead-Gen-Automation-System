import type { ISourceAdapter } from "./ISourceAdapter";
import { apolloAdapter } from "./apollo";

// The single place a lead-source connector is registered. Previously
// search.routes.ts and leads.routes.ts each declared their own identical
// `{ apollo: apolloAdapter }` lookup map — this is the one copy both import
// now, so adding a connector is a one-line addition here instead of an
// edit-two-files-and-hope-they-stay-in-sync exercise.
//
// Only connectors with real, working credentials belong in this map. A
// planned-but-not-yet-implemented connector (Clay, Sales Navigator, ...)
// gets added here only once its adapter module actually exists and its
// required config is in place — never as a placeholder/stub entry, since a
// registered-but-fake connector is worse than an absent one (it would look
// available in `listSourceNames()`/`getSourceAdapter()` without being able
// to do anything).
export const sourceAdapters: Record<string, ISourceAdapter> = {
  apollo: apolloAdapter,
};

export function getSourceAdapter(source: string): ISourceAdapter | null {
  return sourceAdapters[source] ?? null;
}

export function listSourceNames(): string[] {
  return Object.keys(sourceAdapters);
}

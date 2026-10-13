export * from "./interface";
export { RuleBasedEntityExtractor } from "./rule-based";

import { RuleBasedEntityExtractor } from "./rule-based";
import type { EntityExtractionService } from "./interface";

let _defaultExtractor: EntityExtractionService | null = null;

export function getDefaultExtractor(): EntityExtractionService {
  if (!_defaultExtractor) {
    _defaultExtractor = new RuleBasedEntityExtractor();
  }
  return _defaultExtractor;
}

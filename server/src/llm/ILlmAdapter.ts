import type { Lead } from "../types/lead";
import type { ResearchNewsItem, ResearchSource } from "../types/research";
import type { SearchResultItem } from "../search/ISearchAdapter";
import type { QueryPurpose, EvidenceStrength } from "../services/researchIdentity";
import type { ScoredEvidenceResult, ResearchConfidenceResult } from "../services/researchEvidence";

// A search result tagged with which query produced it and why, so the LLM
// prompt (and any future non-LLM evidence-selection logic) can tell person-
// specific evidence apart from company-general evidence, rather than
// treating every result as equally about "this lead."
export interface TaggedSearchResult extends SearchResultItem {
  purpose: QueryPurpose;
  strength: EvidenceStrength;
}

export interface GeneratedResearchBrief {
  companyOverview: string | null;
  recentNews: ResearchNewsItem[];
  painPoints: string[];
  sources: ResearchSource[];
  model: string;
  raw: unknown;
}

export interface GeneratedEmailDraft {
  subject: string;
  body: string;
  model: string;
  raw: unknown;
}

export interface ResearchBriefForDraft {
  companyOverview: string | null;
  recentNews: ResearchNewsItem[];
  painPoints: string[];
}

// Common interface for LLM providers used to synthesize research briefs and draft emails.
export interface ILlmAdapter {
  readonly name: string;
  generateResearchBrief(lead: Lead, searchResults: ScoredEvidenceResult[], confidence: ResearchConfidenceResult): Promise<GeneratedResearchBrief>;
  // hasSavedSignature controls whether the model is allowed to write its own
  // closing line (e.g. "Best,"): when a real signature is configured, that
  // signature already carries its own closing, so the model must not add one
  // too — otherwise the final email ends up with two sign-offs stacked back
  // to back. See groqAdapter.ts's closingInstruction().
  generateEmailDraft(lead: Lead, brief: ResearchBriefForDraft, hasSavedSignature: boolean): Promise<GeneratedEmailDraft>;
  generateFollowUpEmail(
    lead: Lead,
    brief: ResearchBriefForDraft,
    previousSubject: string,
    sequenceNumber: number,
    hasSavedSignature: boolean
  ): Promise<GeneratedEmailDraft>;
}

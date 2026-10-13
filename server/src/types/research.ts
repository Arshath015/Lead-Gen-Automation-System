export type ResearchStatus = "pending" | "in_progress" | "complete" | "failed";

export interface ResearchNewsItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchBrief {
  id: string;
  leadId: string;
  status: ResearchStatus;
  companyOverview: string | null;
  recentNews: ResearchNewsItem[];
  painPoints: string[];
  sources: ResearchSource[];
  rawSearchResults: unknown;
  rawLlmResponse: unknown;
  model: string | null;
  editedByUser: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewResearchBrief = Omit<ResearchBrief, "id" | "leadId" | "createdAt" | "updatedAt">;

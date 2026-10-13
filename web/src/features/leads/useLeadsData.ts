import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { EmailDraft, Lead, LeadStatusCounts, ResearchBrief } from "../../types";

export const DEFAULT_LEADS_PAGE_SIZE = 100;
// Matches the server's own hard ceiling (leads.routes.ts's MAX_PAGE_SIZE) —
// the largest page size a caller can ever get regardless of what it asks
// for, so this is the right "give me effectively everything" value for a
// consumer (the Dashboard) that genuinely needs the whole table to compute
// aggregate stats, without reintroducing truly unbounded loading.
export const MAX_LEADS_PAGE_SIZE = 1000;

// Server-side pagination exists specifically so the browser never has to
// hold an entire (potentially 654K-row) leads table in memory/DOM at once —
// see the leads.routes.ts GET / handler this calls. Status/search filtering
// is pushed server-side too (the same query params the backend already
// supported); the LeadFiltersPanel's more detailed filters and table
// sorting still apply client-side, but now over the current page's leads
// rather than the whole table — see LeadsPage.tsx's comment at its
// filteredLeads definition for that scoping decision.
//
// `initialPageSize` lets a caller that genuinely needs the (bounded) whole
// table — the Dashboard's aggregate stats, not a row-per-lead list — opt
// into MAX_LEADS_PAGE_SIZE instead of the list view's smaller default page.
export function useLeadsData(options: { initialPageSize?: number } = {}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<LeadStatusCounts>({ all: 0, new: 0, qualified: 0, rejected: 0 });
  const [page, setPage] = useState(0); // 0-indexed
  const [pageSize, setPageSize] = useState(options.initialPageSize ?? DEFAULT_LEADS_PAGE_SIZE);
  const [serverStatus, setServerStatus] = useState<string>("");
  const [serverSearch, setServerSearch] = useState("");
  const [briefsByLead, setBriefsByLead] = useState<Record<string, ResearchBrief>>({});
  const [draftsByLead, setDraftsByLead] = useState<Record<string, EmailDraft>>({});
  const [emailFrom, setEmailFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pageResponse, config] = await Promise.all([
        api.listLeads({
          status: serverStatus || undefined,
          search: serverSearch || undefined,
          limit: pageSize,
          offset: page * pageSize,
        }),
        api.getConfig().catch(() => null),
      ]);
      setLeads(pageResponse.leads);
      setTotal(pageResponse.total);
      setStatusCounts(pageResponse.statusCounts);
      if (config) setEmailFrom(config.emailFrom);
      const leadIds = pageResponse.leads.map((l) => l.id);
      const [briefs, drafts] = await Promise.all([
        api.listResearchBriefs(leadIds),
        api.listEmailDrafts(leadIds),
      ]);
      setBriefsByLead(Object.fromEntries(briefs.map((b) => [b.leadId, b])));
      setDraftsByLead(Object.fromEntries(drafts.map((d) => [d.leadId, d])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, serverStatus, serverSearch]);

  useEffect(() => {
    load();
  }, [load]);

  // Changing the server-side status/search filter (or page size) always
  // resets back to the first page — staying on e.g. page 3 of a filter that
  // now matches only one page would just show an empty page.
  function setServerFilter(next: { status?: string; search?: string }) {
    if (next.status !== undefined) setServerStatus(next.status);
    if (next.search !== undefined) setServerSearch(next.search);
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    leads,
    total,
    totalPages,
    page,
    pageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(0);
    },
    serverStatus,
    serverSearch,
    setServerFilter,
    statusCounts,
    briefsByLead,
    draftsByLead,
    emailFrom,
    loading,
    error,
    reload: load,
    setLeads,
    setBriefsByLead,
    setDraftsByLead,
  };
}

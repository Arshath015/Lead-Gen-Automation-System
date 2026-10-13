export type LeadListUrlFilters = {
  search: string;
  stageId: string;
  priority: string;
  channel: string;
  tagId: string;
  ownerFilter: string;
  location: string;
  industry: string;
  source: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  unassigned: boolean;
  missing: string;
  stale: boolean;
  followupDue: string;
};

/**
 * Dashboard drill-downs navigate to the Leads page with URL filters. Keep this
 * parsing in one place so the mounted page can reset its state when those URL
 * parameters change without requiring a full browser reload.
 */
export function getLeadListUrlFilters(searchString: string): LeadListUrlFilters {
  const params = new URLSearchParams(searchString);

  return {
    search: params.get("search") ?? "",
    stageId: params.get("stageId") ?? "all",
    priority: params.get("priority") ?? "all",
    channel: params.get("channel") ?? "all",
    tagId: params.get("tagId") ?? "all",
    ownerFilter: params.get("ownerId") ?? "all",
    location: params.get("location") ?? "",
    industry: params.get("industry") ?? "",
    source: params.get("source") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    status: params.get("status") ?? "all",
    unassigned: params.get("unassigned") === "true",
    missing: params.get("missing") ?? "",
    stale: params.get("stale") === "true",
    followupDue: params.get("followupDue") ?? "",
  };
}
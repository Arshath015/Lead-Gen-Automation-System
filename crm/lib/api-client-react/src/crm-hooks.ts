/**
 * Manual React Query hooks for Contacts, Accounts, Deals, Automation, Lead Conversion.
 * These are hand-written because the codegen pipeline is currently broken (Node 24 / js-yaml ESM issue).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseMutationOptions, UseQueryOptions, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Account {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  size: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  ownerId: number | null;
  ownerName: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountListResponse {
  accounts: Account[];
  total: number;
  page: number;
  limit: number;
}

export interface AccountInput {
  name: string;
  industry?: string;
  website?: string;
  size?: string;
  phone?: string;
  location?: string;
  notes?: string;
  ownerId?: number;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  accountId: number | null;
  accountName: string | null;
  ownerId: number | null;
  ownerName: string | null;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListResponse {
  contacts: Contact[];
  total: number;
  page: number;
  limit: number;
}

export interface ContactInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  accountId?: number;
  ownerId?: number;
  notes?: string;
}

export interface Deal {
  id: number;
  name: string;
  value: string | null;
  currency: string;
  stageId: number | null;
  stageName: string | null;
  stageColor: string | null;
  closeDate: string | null;
  probability: number | null;
  accountId: number | null;
  accountName: string | null;
  contactId: number | null;
  contactName: string | null;
  convertedFromLeadId: number | null;
  ownerId: number | null;
  ownerName: string | null;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealListResponse {
  deals: Deal[];
  total: number;
  page: number;
  limit: number;
}

export interface DealInput {
  name: string;
  value?: string;
  currency?: string;
  stageId?: number;
  closeDate?: string;
  probability?: number;
  accountId?: number;
  contactId?: number;
  ownerId?: number;
  notes?: string;
}

export interface DealUpdate extends Partial<DealInput> {}

export interface AutomationRule {
  id: number;
  name: string;
  trigger: "stage_change" | "new_lead" | "field_value";
  triggerValue: string | null;
  actionType: "create_followup" | "send_notification" | "auto_assign";
  actionValue: string | null;
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleInput {
  name: string;
  trigger: "stage_change" | "new_lead" | "field_value";
  triggerValue?: string;
  actionType: "create_followup" | "send_notification" | "auto_assign";
  actionValue?: string;
  isActive?: boolean;
}

export interface ConvertLeadBody {
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  accountName?: string;
  dealName?: string;
  dealValue?: string;
  dealStageId?: number;
  dealCloseDate?: string;
  createDeal?: boolean;
  createAccount?: boolean;
}

export interface ConvertLeadResponse {
  contactId: number;
  accountId: number | null;
  dealId: number | null;
  message: string;
}

// ─── Query key helpers ───────────────────────────────────────────────────────

export const getListAccountsQueryKey = (params?: Record<string, unknown>): QueryKey =>
  params ? ["listAccounts", params] : ["listAccounts"];

export const getListContactsQueryKey = (params?: Record<string, unknown>): QueryKey =>
  params ? ["listContacts", params] : ["listContacts"];

export const getListDealsQueryKey = (params?: Record<string, unknown>): QueryKey =>
  params ? ["listDeals", params] : ["listDeals"];

export const getListAutomationRulesQueryKey = (): QueryKey => ["listAutomationRules"];

export const getConvertLeadQueryKey = (id: number): QueryKey => ["convertLead", id];

// ─── Accounts ────────────────────────────────────────────────────────────────

export const listAccounts = async (params?: { search?: string; page?: number; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  return customFetch<AccountListResponse>(`/api/accounts${qs.toString() ? `?${qs}` : ""}`);
};

export function useListAccounts(
  params?: { search?: string; page?: number; limit?: number },
  options?: { query?: UseQueryOptions<AccountListResponse> }
) {
  const queryKey = getListAccountsQueryKey(params);
  const queryFn = () => listAccounts(params);
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<AccountListResponse>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createAccount = async (data: AccountInput) =>
  customFetch<Account>("/api/accounts", { method: "POST", body: JSON.stringify(data) });

export function useCreateAccount(options?: { mutation?: UseMutationOptions<Account, unknown, { data: AccountInput }> }) {
  return useMutation({ mutationKey: ["createAccount"], mutationFn: ({ data }) => createAccount(data), ...options?.mutation });
}

export const updateAccount = async (id: number, data: Partial<AccountInput>) =>
  customFetch<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export function useUpdateAccount(options?: { mutation?: UseMutationOptions<Account, unknown, { id: number; data: Partial<AccountInput> }> }) {
  return useMutation({ mutationKey: ["updateAccount"], mutationFn: ({ id, data }) => updateAccount(id, data), ...options?.mutation });
}

export const deleteAccount = async (id: number) =>
  customFetch<void>(`/api/accounts/${id}`, { method: "DELETE" });

export function useDeleteAccount(options?: { mutation?: UseMutationOptions<void, unknown, { id: number }> }) {
  return useMutation({ mutationKey: ["deleteAccount"], mutationFn: ({ id }) => deleteAccount(id), ...options?.mutation });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export const listContacts = async (params?: { search?: string; accountId?: number; page?: number; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.accountId) qs.set("accountId", String(params.accountId));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  return customFetch<ContactListResponse>(`/api/contacts${qs.toString() ? `?${qs}` : ""}`);
};

export function useListContacts(
  params?: { search?: string; accountId?: number; page?: number; limit?: number },
  options?: { query?: UseQueryOptions<ContactListResponse> }
) {
  const queryKey = getListContactsQueryKey(params);
  const queryFn = () => listContacts(params);
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<ContactListResponse>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createContact = async (data: ContactInput) =>
  customFetch<Contact>("/api/contacts", { method: "POST", body: JSON.stringify(data) });

export function useCreateContact(options?: { mutation?: UseMutationOptions<Contact, unknown, { data: ContactInput }> }) {
  return useMutation({ mutationKey: ["createContact"], mutationFn: ({ data }) => createContact(data), ...options?.mutation });
}

export const updateContact = async (id: number, data: Partial<ContactInput>) =>
  customFetch<Contact>(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export function useUpdateContact(options?: { mutation?: UseMutationOptions<Contact, unknown, { id: number; data: Partial<ContactInput> }> }) {
  return useMutation({ mutationKey: ["updateContact"], mutationFn: ({ id, data }) => updateContact(id, data), ...options?.mutation });
}

export const deleteContact = async (id: number) =>
  customFetch<void>(`/api/contacts/${id}`, { method: "DELETE" });

export function useDeleteContact(options?: { mutation?: UseMutationOptions<void, unknown, { id: number }> }) {
  return useMutation({ mutationKey: ["deleteContact"], mutationFn: ({ id }) => deleteContact(id), ...options?.mutation });
}

// ─── Deals ────────────────────────────────────────────────────────────────────

export const listDeals = async (params?: { search?: string; stageId?: number; ownerId?: number; accountId?: number; page?: number; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.stageId) qs.set("stageId", String(params.stageId));
  if (params?.ownerId) qs.set("ownerId", String(params.ownerId));
  if (params?.accountId) qs.set("accountId", String(params.accountId));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  return customFetch<DealListResponse>(`/api/deals${qs.toString() ? `?${qs}` : ""}`);
};

export function useListDeals(
  params?: { search?: string; stageId?: number; ownerId?: number; accountId?: number; page?: number; limit?: number },
  options?: { query?: UseQueryOptions<DealListResponse> }
) {
  const queryKey = getListDealsQueryKey(params);
  const queryFn = () => listDeals(params);
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<DealListResponse>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createDeal = async (data: DealInput) =>
  customFetch<Deal>("/api/deals", { method: "POST", body: JSON.stringify(data) });

export function useCreateDeal(options?: { mutation?: UseMutationOptions<Deal, unknown, { data: DealInput }> }) {
  return useMutation({ mutationKey: ["createDeal"], mutationFn: ({ data }) => createDeal(data), ...options?.mutation });
}

export const updateDeal = async (id: number, data: DealUpdate) =>
  customFetch<Deal>(`/api/deals/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export function useUpdateDeal(options?: { mutation?: UseMutationOptions<Deal, unknown, { id: number; data: DealUpdate }> }) {
  return useMutation({ mutationKey: ["updateDeal"], mutationFn: ({ id, data }) => updateDeal(id, data), ...options?.mutation });
}

export const updateDealStage = async (id: number, stageId: number) =>
  customFetch<Deal>(`/api/deals/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stageId }) });

export function useUpdateDealStage(options?: { mutation?: UseMutationOptions<Deal, unknown, { id: number; stageId: number }> }) {
  return useMutation({ mutationKey: ["updateDealStage"], mutationFn: ({ id, stageId }) => updateDealStage(id, stageId), ...options?.mutation });
}

export const deleteDeal = async (id: number) =>
  customFetch<void>(`/api/deals/${id}`, { method: "DELETE" });

export function useDeleteDeal(options?: { mutation?: UseMutationOptions<void, unknown, { id: number }> }) {
  return useMutation({ mutationKey: ["deleteDeal"], mutationFn: ({ id }) => deleteDeal(id), ...options?.mutation });
}

// ─── Lead Conversion ─────────────────────────────────────────────────────────

export const convertLead = async (id: number, data: ConvertLeadBody) =>
  customFetch<ConvertLeadResponse>(`/api/leads/${id}/convert`, { method: "POST", body: JSON.stringify(data) });

export function useConvertLead(options?: { mutation?: UseMutationOptions<ConvertLeadResponse, unknown, { id: number; data: ConvertLeadBody }> }) {
  return useMutation({ mutationKey: ["convertLead"], mutationFn: ({ id, data }) => convertLead(id, data), ...options?.mutation });
}

// ─── Automation Rules ─────────────────────────────────────────────────────────

export const listAutomationRules = async () =>
  customFetch<AutomationRule[]>("/api/automation/rules");

export function useListAutomationRules(options?: { query?: UseQueryOptions<AutomationRule[]> }) {
  const queryKey = getListAutomationRulesQueryKey();
  const queryFn = () => listAutomationRules();
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<AutomationRule[]>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createAutomationRule = async (data: AutomationRuleInput) =>
  customFetch<AutomationRule>("/api/automation/rules", { method: "POST", body: JSON.stringify(data) });

export function useCreateAutomationRule(options?: { mutation?: UseMutationOptions<AutomationRule, unknown, { data: AutomationRuleInput }> }) {
  return useMutation({ mutationKey: ["createAutomationRule"], mutationFn: ({ data }) => createAutomationRule(data), ...options?.mutation });
}

export const updateAutomationRule = async (id: number, data: Partial<AutomationRuleInput>) =>
  customFetch<AutomationRule>(`/api/automation/rules/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export function useUpdateAutomationRule(options?: { mutation?: UseMutationOptions<AutomationRule, unknown, { id: number; data: Partial<AutomationRuleInput> }> }) {
  return useMutation({ mutationKey: ["updateAutomationRule"], mutationFn: ({ id, data }) => updateAutomationRule(id, data), ...options?.mutation });
}

export const deleteAutomationRule = async (id: number) =>
  customFetch<void>(`/api/automation/rules/${id}`, { method: "DELETE" });

export function useDeleteAutomationRule(options?: { mutation?: UseMutationOptions<void, unknown, { id: number }> }) {
  return useMutation({ mutationKey: ["deleteAutomationRule"], mutationFn: ({ id }) => deleteAutomationRule(id), ...options?.mutation });
}

// ─── Contact / Deal Single-record fetch ──────────────────────────────────────

export const getContact = async (id: number) =>
  customFetch<Contact>(`/api/contacts/${id}`);

export const getGetContactQueryKey = (id: number) => ["getContact", id] as const;

export function useGetContact(id: number, options?: { query?: UseQueryOptions<Contact> }) {
  const queryKey = getGetContactQueryKey(id);
  const queryFn = () => getContact(id);
  const query = useQuery({ queryKey, queryFn, enabled: !!id, ...options?.query }) as ReturnType<typeof useQuery<Contact>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const getDeal = async (id: number) =>
  customFetch<Deal>(`/api/deals/${id}`);

export const getGetDealQueryKey = (id: number) => ["getDeal", id] as const;

export function useGetDeal(id: number, options?: { query?: UseQueryOptions<Deal> }) {
  const queryKey = getGetDealQueryKey(id);
  const queryFn = () => getDeal(id);
  const query = useQuery({ queryKey, queryFn, enabled: !!id, ...options?.query }) as ReturnType<typeof useQuery<Deal>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

// ─── Contact Notes ───────────────────────────────────────────────────────────

export interface CrmNote {
  id: number;
  leadId: number | null;
  contactId: number | null;
  dealId: number | null;
  type: string;
  content: string;
  createdById: number | null;
  createdByName: string | null;
  createdByAvatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmNoteInput { content: string; type?: "note" | "email" | "call"; }

export const listContactNotes = async (contactId: number) =>
  customFetch<CrmNote[]>(`/api/contacts/${contactId}/notes`);

export const getListContactNotesQueryKey = (contactId: number) => ["listContactNotes", contactId] as const;

export function useListContactNotes(contactId: number, options?: { query?: UseQueryOptions<CrmNote[]> }) {
  const queryKey = getListContactNotesQueryKey(contactId);
  const queryFn = () => listContactNotes(contactId);
  const query = useQuery({ queryKey, queryFn, enabled: !!contactId, ...options?.query }) as ReturnType<typeof useQuery<CrmNote[]>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createContactNote = async (contactId: number, data: CrmNoteInput) =>
  customFetch<CrmNote>(`/api/contacts/${contactId}/notes`, { method: "POST", body: JSON.stringify(data) });

export function useCreateContactNote(options?: { mutation?: UseMutationOptions<CrmNote, unknown, { contactId: number; data: CrmNoteInput }> }) {
  return useMutation({ mutationKey: ["createContactNote"], mutationFn: ({ contactId, data }) => createContactNote(contactId, data), ...options?.mutation });
}

// ─── Deal Notes ──────────────────────────────────────────────────────────────

export const listDealNotes = async (dealId: number) =>
  customFetch<CrmNote[]>(`/api/deals/${dealId}/notes`);

export const getListDealNotesQueryKey = (dealId: number) => ["listDealNotes", dealId] as const;

export function useListDealNotes(dealId: number, options?: { query?: UseQueryOptions<CrmNote[]> }) {
  const queryKey = getListDealNotesQueryKey(dealId);
  const queryFn = () => listDealNotes(dealId);
  const query = useQuery({ queryKey, queryFn, enabled: !!dealId, ...options?.query }) as ReturnType<typeof useQuery<CrmNote[]>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

export const createDealNote = async (dealId: number, data: CrmNoteInput) =>
  customFetch<CrmNote>(`/api/deals/${dealId}/notes`, { method: "POST", body: JSON.stringify(data) });

export function useCreateDealNote(options?: { mutation?: UseMutationOptions<CrmNote, unknown, { dealId: number; data: CrmNoteInput }> }) {
  return useMutation({ mutationKey: ["createDealNote"], mutationFn: ({ dealId, data }) => createDealNote(dealId, data), ...options?.mutation });
}

// ── Dashboard: Deals by Stage ──────────────────────────────────────────────
export interface DealStageCount {
  stageId: number;
  stageName: string;
  stageColor: string | null;
  isWon: boolean;
  isLost: boolean;
  count: number;
}

export function getDealsByStageQueryKey() {
  return ["/api/dashboard/deals-by-stage"] as const;
}

export function useGetDealsByStage(options?: { query?: Partial<UseQueryOptions<DealStageCount[]>> }) {
  const queryKey = getDealsByStageQueryKey();
  const queryFn = () => customFetch<DealStageCount[]>("/api/dashboard/deals-by-stage");
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<DealStageCount[]>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

// ── Dashboard: Revenue Over Time ───────────────────────────────────────────
export interface RevenueOverTimePoint {
  month: string;
  total: number;
  cumulative: number;
}

export function getRevenueOverTimeQueryKey() {
  return ["/api/dashboard/revenue-over-time"] as const;
}

export function useGetRevenueOverTime(options?: { query?: Partial<UseQueryOptions<RevenueOverTimePoint[]>> }) {
  const queryKey = getRevenueOverTimeQueryKey();
  const queryFn = () => customFetch<RevenueOverTimePoint[]>("/api/dashboard/revenue-over-time");
  const query = useQuery({ queryKey, queryFn, ...options?.query }) as ReturnType<typeof useQuery<RevenueOverTimePoint[]>> & { queryKey: QueryKey };
  query.queryKey = queryKey;
  return query;
}

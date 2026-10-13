export * from "./generated/api";
export * from "./generated/api.schemas";
export type { CrmNote, CrmNoteInput } from "./crm-hooks";
export {
  listContactNotes, getListContactNotesQueryKey, useListContactNotes,
  createContactNote, useCreateContactNote,
  listDealNotes, getListDealNotesQueryKey, useListDealNotes,
  createDealNote, useCreateDealNote,
  // Dashboard deal widgets
  useGetDealsByStage, getDealsByStageQueryKey,
  useGetRevenueOverTime, getRevenueOverTimeQueryKey,
} from "./crm-hooks";
export type { DealStageCount, RevenueOverTimePoint } from "./crm-hooks";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

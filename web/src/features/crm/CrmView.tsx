// Embeds the separate CRM app (see CRM_INTEGRATION_OVERVIEW.pdf) inside this
// app's own shell via an iframe, so switching between Lead-Gen and the CRM
// never leaves this window/tab. The two stay two separate codebases/backends
// (see server/src/crm/crmClient.ts for the "Send to CRM" API bridge) — this
// is purely a frontend convenience, not a deeper merge of the two apps.
const CRM_URL = import.meta.env.VITE_CRM_URL ?? "http://localhost:5191";

export function CrmView() {
  return (
    <iframe
      src={CRM_URL}
      title="CRM"
      className="h-full w-full border-0"
      // The CRM has its own login/session — nothing here shares auth with
      // the Lead-Gen app, so the CRM's own login screen appears inside the
      // frame on first use, same as opening it directly.
    />
  );
}

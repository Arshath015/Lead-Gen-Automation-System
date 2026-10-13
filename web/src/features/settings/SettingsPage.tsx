import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Plug, Users, KeyRound, Info, PenSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { useHealth } from "../../lib/useHealth";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import { AutomationSettingsPanel } from "./AutomationSettingsPanel";
import { SignatureEditor } from "./SignatureEditor";
import { DefaultAttachmentsPanel } from "./DefaultAttachmentsPanel";
import type { ConnectorStatus, EmailAutomationSettings } from "../../types";

// Presentation-only detail (icon, short role blurb) for a connector, keyed by
// its backend `name` — the /api/connectors response itself deliberately
// carries no UI metadata, only name/capabilities/configured. Any connector
// not listed here (nothing exists yet besides Apollo) still renders fine via
// DEFAULT_CONNECTOR_META rather than being dropped or crashing.
const CONNECTOR_META: Record<string, { role: string; icon: LucideIcon }> = {
  apollo: { role: "Lead search & contact reveal", icon: Users },
};
const DEFAULT_CONNECTOR_META: { role: string; icon: LucideIcon } = { role: "Lead-source connector", icon: Plug };

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border-subtle bg-surface p-6 shadow-card ${className}`}>{children}</div>;
}

function EmailSignatureCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<EmailAutomationSettings | null>(null);

  useEffect(() => {
    api.getAutomationSettings().then(setSettings);
  }, []);

  async function saveSignature(html: string) {
    try {
      const saved = await api.updateAutomationSettings({ emailSignature: html });
      setSettings(saved);
      toast.push({ variant: "success", title: "Signature saved" });
    } catch (e) {
      toast.push({ variant: "error", title: "Couldn't save signature", description: (e as Error).message });
      throw e;
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <PenSquare className="size-4 text-gray-400" />
        <h3 className="text-[15px] font-bold text-ink">Email signature</h3>
      </div>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Appended to every outgoing email — manual sends, automated sends, and follow-ups. Added once at send time, so
        editing or regenerating a draft never duplicates it.
      </p>
      <div className="mt-3">{settings && <SignatureEditor value={settings.emailSignature} onSave={saveSignature} />}</div>
    </Card>
  );
}

export function SettingsPage() {
  const healthy = useHealth(15000);
  const [emailFrom, setEmailFrom] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [connectorsFailed, setConnectorsFailed] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setEmailFrom(c.emailFrom))
      .catch(() => setEmailFrom(null));
  }, []);

  useEffect(() => {
    api
      .listConnectors()
      .then(setConnectors)
      .catch(() => setConnectorsFailed(true));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader title="Settings" description="Configure automation, integrations, and account preferences." />

      <div className="grid grid-cols-1 gap-6 px-6 pb-10 xl:grid-cols-2">
        <AutomationSettingsPanel />

        <div className="space-y-6">
          <EmailSignatureCard />
          <DefaultAttachmentsPanel />

          <Card>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug className="size-4 text-gray-400" />
                <h3 className="text-[15px] font-bold text-ink">Backend connection</h3>
              </div>
              <span
                className={
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium " +
                  (healthy === null ? "bg-gray-100 text-gray-500" : healthy ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
                }
              >
                <span className={"size-1.5 rounded-full " + (healthy === null ? "bg-gray-400" : healthy ? "bg-emerald-500" : "bg-red-500")} />
                {healthy === null ? "Checking…" : healthy ? "All systems operational" : "Unreachable"}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">localhost:4000</p>
          </Card>

          <Card>
            <h3 className="text-[15px] font-bold text-ink">Integrations</h3>
            <p className="mt-0.5 text-[13px] text-gray-500">
              Lead-source connectors currently registered with the backend.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {connectorsFailed ? (
                <p className="col-span-2 text-[13px] text-gray-400">Couldn't load connector status.</p>
              ) : connectors === null ? (
                <>
                  <Skeleton className="h-[104px] rounded-xl" />
                  <Skeleton className="h-[104px] rounded-xl" />
                </>
              ) : (
                connectors.map((connector) => {
                  const meta = CONNECTOR_META[connector.name] ?? DEFAULT_CONNECTOR_META;
                  const Icon = meta.icon;
                  return (
                    <div key={connector.name} className="rounded-xl border border-border-subtle p-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                        <Icon className="size-4" />
                      </div>
                      <p className="mt-2 text-[13px] font-semibold capitalize text-ink">{connector.name}</p>
                      <p className="text-[11px] text-gray-400">{meta.role}</p>
                      <span
                        className={
                          "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
                          (connector.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")
                        }
                      >
                        {connector.configured ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                        {connector.configured ? "Configured" : "Not configured"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-gray-400" />
              <h3 className="text-[15px] font-bold text-ink">Apollo credit usage</h3>
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">
              Search and reveal draw from different limits — running out of one doesn't affect the other.
            </p>
            <div className="mt-3 divide-y divide-border-subtle">
              <div className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-ink">Finding leads (search)</p>
                  <p className="text-[11px] text-gray-400">"Find leads" and ICP profile search</p>
                </div>
                <span className="text-[13px] font-semibold text-emerald-600">Unmetered</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-ink">Revealing contact info</p>
                  <p className="text-[11px] text-gray-400">"Reveal email" — single or bulk</p>
                </div>
                <span className="text-[13px] font-semibold text-amber-600">1 credit each</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-gray-400" />
              <p className="text-[11.5px] text-gray-500">
                Apollo doesn't expose a remaining-credit count via this integration, so no balance is shown here — only
                which actions consume credits. If reveal credits run out, search keeps working. To test the rest of the
                workflow without spending credits, use "Add lead" with your own test email already filled in.
              </p>
            </div>
          </Card>

          <Card>
            <h3 className="text-[15px] font-bold text-ink">Sender identity</h3>
            <p className="mt-0.5 text-[13px] text-gray-500">
              The address recipients see. Set via server configuration (<code className="text-[12px]">EMAIL_FROM</code>), not editable here.
            </p>
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-700">
              {emailFrom ?? "Unavailable"}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

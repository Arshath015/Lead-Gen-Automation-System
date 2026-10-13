import { useEffect, useState } from "react";
import {
  PauseCircle,
  PenSquare,
  Send,
  Repeat,
  Calendar,
  Clock,
  CalendarDays,
  Hourglass,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Switch } from "../../components/ui/Switch";
import { inputClass } from "../../components/ui/field";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import { cn } from "../../lib/cn";
import type { EmailAutomationSettings } from "../../types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AutomationSettingsPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<EmailAutomationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    try {
      setSettings(await api.getAutomationSettings());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(patch: Partial<EmailAutomationSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateAutomationSettings(patch);
      setSettings(saved);
    } catch (e) {
      setSettings(settings); // revert
      setError((e as Error).message);
      toast.push({ variant: "error", title: "Couldn't save automation settings", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: number) {
    if (!settings) return;
    const days = settings.sendingDays.includes(day)
      ? settings.sendingDays.filter((d) => d !== day)
      : [...settings.sendingDays, day].sort();
    save({ sendingDays: days });
  }

  if (!settings) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card">
        <p className="text-xs text-gray-400">{error ?? "Loading automation settings…"}</p>
      </div>
    );
  }

  const hourLabel = (h: number) => {
    const clamped = ((h % 24) + 24) % 24;
    const period = clamped >= 12 ? "PM" : "AM";
    const twelve = clamped % 12 === 0 ? 12 : clamped % 12;
    return `${String(twelve).padStart(2, "0")}:00 ${period}`;
  };
  const activeDayLabels = settings.sendingDays.map((d) => DAY_LABELS[d]).join(", ") || "None";

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card">
      <h3 className="text-[15px] font-bold text-ink">Email automation</h3>
      <p className="mt-0.5 text-[13px] text-gray-500">Control how the CRM automates your outreach.</p>

      {error && <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {settings.paused && (settings.autoDraftEnabled || settings.autoSendEnabled || settings.autoFollowUpEnabled) && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <PauseCircle className="size-3.5 shrink-0" />
          Automation is paused — the toggles below are saved but won't run anything until you resume.
        </div>
      )}

      <div className="mt-4 divide-y divide-border-subtle">
        <ToggleRow
          icon={PauseCircle}
          label="Pause everything"
          description="Temporarily pause all automated actions"
          checked={settings.paused}
          onChange={(v) => save({ paused: v })}
        />
        <ToggleRow
          icon={PenSquare}
          label="Auto-draft emails"
          description="Automatically draft emails after research is complete"
          checked={settings.autoDraftEnabled}
          onChange={(v) => save({ autoDraftEnabled: v })}
        />
        <ToggleRow
          icon={Send}
          label="Auto-send emails"
          description="Automatically send emails after a draft is ready"
          checked={settings.autoSendEnabled}
          onChange={(v) => save({ autoSendEnabled: v })}
        />
        <ToggleRow
          icon={Repeat}
          label="Auto-follow-up"
          description="Automatically send follow-up emails"
          checked={settings.autoFollowUpEnabled}
          onChange={(v) => save({ autoFollowUpEnabled: v })}
        />
      </div>

      <div className="mt-2 divide-y divide-border-subtle border-t border-border-subtle">
        <ExpandableRow
          icon={Calendar}
          label="Daily send limit"
          value={`${settings.dailySendLimit} emails`}
          open={expanded === "dailyLimit"}
          onToggle={() => setExpanded((e) => (e === "dailyLimit" ? null : "dailyLimit"))}
        >
          <input
            type="number"
            min={1}
            className={inputClass}
            value={settings.dailySendLimit}
            onChange={(e) => save({ dailySendLimit: Math.max(1, Number(e.target.value) || 1) })}
          />
        </ExpandableRow>

        <ExpandableRow
          icon={Clock}
          label="Delay between emails"
          value={`${settings.delayBetweenEmailsMinutes} minutes`}
          open={expanded === "delay"}
          onToggle={() => setExpanded((e) => (e === "delay" ? null : "delay"))}
        >
          <input
            type="number"
            min={1}
            className={inputClass}
            value={settings.delayBetweenEmailsMinutes}
            onChange={(e) => save({ delayBetweenEmailsMinutes: Math.max(1, Number(e.target.value) || 1) })}
          />
        </ExpandableRow>

        <ExpandableRow
          icon={Hourglass}
          label="Sending hours"
          value={`${hourLabel(settings.sendingHourStart)} - ${hourLabel(settings.sendingHourEnd)}`}
          open={expanded === "hours"}
          onToggle={() => setExpanded((e) => (e === "hours" ? null : "hours"))}
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={23}
              className={inputClass}
              value={settings.sendingHourStart}
              onChange={(e) => save({ sendingHourStart: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })}
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="number"
              min={1}
              max={24}
              className={inputClass}
              value={settings.sendingHourEnd}
              onChange={(e) => save({ sendingHourEnd: Math.min(24, Math.max(1, Number(e.target.value) || 24)) })}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">Local server time. Use 24 for "end of day".</p>
        </ExpandableRow>

        <ExpandableRow
          icon={CalendarDays}
          label="Sending days"
          value={activeDayLabels}
          open={expanded === "days"}
          onToggle={() => setExpanded((e) => (e === "days" ? null : "days"))}
        >
          <div className="flex gap-1.5">
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                onClick={() => toggleDay(day)}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center rounded-lg text-[11px] font-semibold transition-colors",
                  settings.sendingDays.includes(day)
                    ? "bg-accent-600 text-white"
                    : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                )}
              >
                {label[0]}
              </button>
            ))}
          </div>
        </ExpandableRow>

        <ExpandableRow
          icon={Repeat}
          label="Follow-ups per lead"
          value={`${settings.followUpCount} follow-up${settings.followUpCount === 1 ? "" : "s"}`}
          open={expanded === "followUpCount"}
          onToggle={() => setExpanded((e) => (e === "followUpCount" ? null : "followUpCount"))}
        >
          <input
            type="number"
            min={0}
            max={10}
            className={inputClass}
            value={settings.followUpCount}
            onChange={(e) => save({ followUpCount: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </ExpandableRow>

        <ExpandableRow
          icon={Clock}
          label="Days between follow-ups"
          value={`${settings.followUpDelayDays} day${settings.followUpDelayDays === 1 ? "" : "s"}`}
          open={expanded === "followUpDelay"}
          onToggle={() => setExpanded((e) => (e === "followUpDelay" ? null : "followUpDelay"))}
        >
          <input
            type="number"
            min={1}
            className={inputClass}
            value={settings.followUpDelayDays}
            onChange={(e) => save({ followUpDelayDays: Math.max(1, Number(e.target.value) || 1) })}
          />
        </ExpandableRow>
      </div>

      {saving && <p className="mt-3 text-[11px] text-gray-400">Saving…</p>}
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: typeof PauseCircle;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-500">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-[13.5px] font-semibold text-ink">{label}</p>
          <p className="text-[12px] text-gray-400">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function ExpandableRow({
  icon: Icon,
  label,
  value,
  open,
  onToggle,
  children,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-lg py-2.5 text-left hover:bg-gray-50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-500">
            <Icon className="size-4" />
          </span>
          <span className="text-[13.5px] font-medium text-ink">{label}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
          {value}
          {open ? <ChevronDown className="size-3.5 text-gray-400" /> : <ChevronRight className="size-3.5 text-gray-400" />}
        </span>
      </button>
      {open && <div className="pb-3 pl-12 pr-1 pt-1">{children}</div>}
    </div>
  );
}

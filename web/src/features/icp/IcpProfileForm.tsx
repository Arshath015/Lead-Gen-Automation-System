import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../components/ui/field";
import type { IcpFilters, IcpProfile } from "../../types";

const emptyFilters: IcpFilters = {
  personTitles: [],
  personLocations: [],
  organizationLocations: [],
  organizationDomains: [],
  employeeRanges: [],
  keywords: "",
};

function toList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A hyphen ("11-50"), not a comma, separates the two numbers of a range —
// commas are already the separator between list entries (toList above), so
// "1,10, 11,50" (Apollo's own comma format) would otherwise shatter into
// four bogus bare numbers. A bare number ("200") means "200 or more" — see
// normalizeEmployeeRanges in server/src/sources/apollo.ts, which sends it to
// Apollo as an open-ended minimum rather than silently dropping it.
const EMPLOYEE_RANGE_ENTRY_RE = /^\d+(\s*-\s*\d+)?$/;

function invalidEmployeeRangeEntries(value: string): string[] {
  return toList(value).filter((entry) => !EMPLOYEE_RANGE_ENTRY_RE.test(entry));
}

// Two bare numbers landing next to each other after the comma-split above
// ("1,10" -> ["1", "10"]) are individually valid minimum entries on their
// own, so invalidEmployeeRangeEntries alone can't catch this — but nobody
// ever actually wants two independent open-ended minimums: a "200+" filter
// is already a superset of "300+", so their union is just "200+" again. Any
// adjacent bare-number pair is therefore always a range typed with a comma
// instead of a hyphen, and must be rejected rather than silently kept as two
// separate (redundant, wrong) minimum filters.
function commaRangeTypos(value: string): string[] {
  const tokens = toList(value);
  const typos: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/^\d+$/.test(tokens[i]) && /^\d+$/.test(tokens[i + 1])) {
      typos.push(`${tokens[i]},${tokens[i + 1]}`);
    }
  }
  return typos;
}

interface Props {
  initial?: IcpProfile;
  submitLabel: string;
  onSubmit: (name: string, filters: IcpFilters) => Promise<void>;
  onCancel?: () => void;
}

export function IcpProfileForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [titles, setTitles] = useState(initial?.filters.personTitles.join(", ") ?? "");
  const [personLocations, setPersonLocations] = useState(initial?.filters.personLocations.join(", ") ?? "");
  const [orgLocations, setOrgLocations] = useState(initial?.filters.organizationLocations.join(", ") ?? "");
  const [domains, setDomains] = useState(initial?.filters.organizationDomains.join(", ") ?? "");
  const [employeeRange, setEmployeeRange] = useState(initial?.filters.employeeRanges.join(", ") ?? "");
  const [keywords, setKeywords] = useState(initial?.filters.keywords ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Profile name is required");
      return;
    }
    const rangeTypos = commaRangeTypos(employeeRange);
    if (rangeTypos.length > 0) {
      setError(
        `Employee range: "${rangeTypos.join('", "')}" looks like a range typed with a comma — that's read as two separate minimums, not a range. Use a hyphen instead (e.g. "${rangeTypos[0].replace(",", "-")}").`
      );
      return;
    }
    const badEntries = invalidEmployeeRangeEntries(employeeRange);
    if (badEntries.length > 0) {
      setError(
        `Employee range: "${badEntries.join(", ")}" isn't a number or a "min-max" range (e.g. 200 or 11-50) — fix or remove ${
          badEntries.length === 1 ? "it" : "them"
        } before saving.`
      );
      return;
    }
    const filters: IcpFilters = {
      ...emptyFilters,
      personTitles: toList(titles),
      personLocations: toList(personLocations),
      organizationLocations: toList(orgLocations),
      organizationDomains: toList(domains),
      employeeRanges: toList(employeeRange),
      keywords,
    };
    setSaving(true);
    try {
      await onSubmit(name, filters);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <div>
        <label className={labelClass}>Profile name</label>
        <input className={inputClass + " mt-1"} placeholder="e.g. US SaaS Founders" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass}>Job titles</label>
          <input className={inputClass + " mt-1"} placeholder="Founder, CEO" value={titles} onChange={(e) => setTitles(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Person location</label>
          <input className={inputClass + " mt-1"} placeholder="United States" value={personLocations} onChange={(e) => setPersonLocations(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Company HQ</label>
          <input className={inputClass + " mt-1"} placeholder="Optional" value={orgLocations} onChange={(e) => setOrgLocations(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Company domains</label>
          <input className={inputClass + " mt-1"} placeholder="Optional" value={domains} onChange={(e) => setDomains(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Employee range</label>
          <input className={inputClass + " mt-1"} placeholder="200 for 200+, or 11-50, 51-200" value={employeeRange} onChange={(e) => setEmployeeRange(e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-400">
            A single number means that many employees or more. Use a hyphen (not a comma) for a range — commas separate multiple entries.
          </p>
        </div>
        <div>
          <label className={labelClass}>Keyword</label>
          <input className={inputClass + " mt-1"} placeholder="Single word or short phrase, e.g. GCC" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-400">
            Unlike the fields above, this is one exact phrase Apollo searches for — not a comma-separated list.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useState } from "react";
import { Plus, Search, ChevronLeft } from "lucide-react";
import { Modal } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../components/ui/field";
import { IcpProfileForm } from "../icp/IcpProfileForm";
import { describeSearchResult } from "./searchToast";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import type { IcpFilters, IcpProfile } from "../../types";

function summarize(filters: IcpFilters): string {
  const parts = [
    filters.personTitles.length ? filters.personTitles.join(", ") : null,
    filters.personLocations.length ? filters.personLocations.join(", ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No filters set";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchComplete: () => void;
}

export function FindLeadsModal({ open, onOpenChange, onSearchComplete }: Props) {
  const toast = useToast();
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(25);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProfiles() {
    setLoadingProfiles(true);
    try {
      const list = await api.listIcpProfiles();
      setProfiles(list);
      if (list.length === 0) setMode("create");
      else setSelectedId((prev) => prev ?? list[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingProfiles(false);
    }
  }

  useEffect(() => {
    if (open) {
      setError(null);
      setMode("pick");
      loadProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleCreate(name: string, filters: IcpFilters) {
    const profile = await api.createIcpProfile(name, filters);
    await loadProfiles();
    setSelectedId(profile.id);
    setMode("pick");
    toast.push({ variant: "success", title: `"${profile.name}" profile created` });
  }

  async function handleRunSearch() {
    if (!selectedId) return;
    setSearching(true);
    setError(null);
    try {
      const result = await api.runSearch(selectedId, undefined, perPage);
      toast.push(describeSearchResult(result));
      onSearchComplete();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "pick" ? "Find leads" : "New ICP profile"}
      description={
        mode === "pick"
          ? "Pick a saved ideal-customer profile and pull matching leads from Apollo."
          : "Define who you're targeting. Fields are comma-separated where multiple values apply."
      }
      className="max-w-lg"
    >
      {error && (
        <div className="mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {mode === "pick" && (
        <div className="space-y-3">
          {loadingProfiles && <p className="py-6 text-center text-xs text-gray-400">Loading profiles…</p>}

          {!loadingProfiles && profiles.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors " +
                    (selectedId === p.id
                      ? "border-accent-500 bg-accent-50/60 ring-1 ring-accent-500/30"
                      : "border-border hover:border-gray-300 hover:bg-gray-50")
                  }
                >
                  <p className="text-[13px] font-medium text-ink">{p.name}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{summarize(p.filters)}</p>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setMode("create")}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-ink"
          >
            <Plus className="size-3.5" />
            Create new profile
          </button>

          <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
            <div className="flex items-center gap-1.5">
              <label className={labelClass}>Results</label>
              <input
                type="number"
                min={1}
                max={100}
                value={perPage}
                onChange={(e) => setPerPage(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className={inputClass + " w-16 text-center"}
              />
            </div>
            <Button variant="primary" onClick={handleRunSearch} disabled={!selectedId} loading={searching}>
              <Search className="size-3.5" />
              Run search
            </Button>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="space-y-3">
          {profiles.length > 0 && (
            <button
              type="button"
              onClick={() => setMode("pick")}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-ink"
            >
              <ChevronLeft className="size-3.5" />
              Back to profiles
            </button>
          )}
          <IcpProfileForm submitLabel="Save profile" onSubmit={handleCreate} />
        </div>
      )}
    </Modal>
  );
}

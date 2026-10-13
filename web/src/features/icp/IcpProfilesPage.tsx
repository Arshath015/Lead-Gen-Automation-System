import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, Target } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Dialog";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Skeleton } from "../../components/ui/Skeleton";
import { inputClass } from "../../components/ui/field";
import { IcpProfileForm } from "./IcpProfileForm";
import { describeSearchResult } from "../leads/searchToast";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import { formatRelativeTime } from "../../lib/format";
import type { IcpFilters, IcpProfile } from "../../types";

const CHIP_COLORS = [
  "bg-violet-50 text-violet-600",
  "bg-emerald-50 text-emerald-600",
  "bg-amber-50 text-amber-600",
  "bg-blue-50 text-blue-600",
  "bg-red-50 text-red-600",
  "bg-teal-50 text-teal-600",
];

// Mirrors normalizeEmployeeRanges in server/src/sources/apollo.ts: a bare
// number is an open-ended minimum, a hyphenated pair is a range. Shown here
// so the profile list communicates the filter Apollo actually applies
// ("200+"), not the raw stored string ("200"), which reads as an exact
// headcount rather than a floor.
function formatEmployeeRange(raw: string): string {
  const bare = raw.match(/^\s*(\d+)\s*$/);
  if (bare) return `${bare[1]}+`;
  const range = raw.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (range) return `${range[1]}–${range[2]}`;
  return raw;
}

function chips(filters: IcpFilters): { label: string; values: string[] }[] {
  return [
    { label: "Titles", values: filters.personTitles },
    { label: "Location", values: filters.personLocations },
    { label: "Company HQ", values: filters.organizationLocations },
    { label: "Size", values: filters.employeeRanges.map(formatEmployeeRange) },
  ].filter((c) => c.values.length > 0);
}

export function IcpProfilesPage() {
  const toast = useToast();
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<IcpProfile | null>(null);
  const [deleting, setDeleting] = useState<IcpProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [searchingId, setSearchingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await api.listIcpProfiles());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [profiles, search]);

  async function handleCreate(name: string, filters: IcpFilters) {
    const profile = await api.createIcpProfile(name, filters);
    setCreateOpen(false);
    await load();
    toast.push({ variant: "success", title: `"${profile.name}" created` });
  }

  async function handleUpdate(name: string, filters: IcpFilters) {
    if (!editing) return;
    await api.updateIcpProfile(editing.id, { name, filters });
    setEditing(null);
    await load();
    toast.push({ variant: "success", title: "Profile updated" });
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteIcpProfile(deleting.id);
      setDeleting(null);
      await load();
      toast.push({ variant: "success", title: "Profile deleted" });
    } catch (e) {
      toast.push({ variant: "error", title: "Delete failed", description: (e as Error).message });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleRunSearch(profile: IcpProfile) {
    setSearchingId(profile.id);
    try {
      const result = await api.runSearch(profile.id, undefined, 25);
      toast.push(describeSearchResult(result));
    } catch (e) {
      toast.push({ variant: "error", title: "Search failed", description: (e as Error).message });
    } finally {
      setSearchingId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader
        title="ICP Profiles"
        description="Create and manage your Ideal Customer Profiles to find the right leads."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New profile
          </Button>
        }
      />

      <div className="px-6 pb-8">
        {!loading && profiles.length > 0 && (
          <div className="relative mb-5 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
            <input
              className={inputClass + " pl-9"}
              placeholder="Search ICP profiles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
            <button onClick={load} className="font-medium underline">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <Target className="mb-2 size-6 text-gray-300" />
            <p className="text-[14px] font-medium text-ink">No ICP profiles yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-gray-500">
              Create a profile to define who you're targeting, then pull matching leads from Apollo.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" />
              New profile
            </Button>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-gray-400">No profiles match "{search}".</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProfiles.map((p, i) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className={`flex size-10 items-center justify-center rounded-xl ${CHIP_COLORS[i % CHIP_COLORS.length]}`}>
                    <Target className="size-[18px]" />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <Pencil className="size-3.5" />
                    </button>
                    <button onClick={() => setDeleting(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-[14.5px] font-bold text-ink">{p.name}</p>

                <div className="mt-2.5 flex-1 space-y-1.5">
                  {chips(p.filters).length === 0 ? (
                    <p className="text-xs text-gray-400">No filters set</p>
                  ) : (
                    chips(p.filters).map((c) => (
                      <div key={c.label} className="flex items-start justify-between gap-1.5 text-[12.5px]">
                        <span className="shrink-0 text-gray-400">{c.label}</span>
                        <span className="min-w-0 truncate text-right text-gray-600">{c.values.join(", ")}</span>
                      </div>
                    ))
                  )}
                </div>

                <p className="mt-3 text-[11px] text-gray-400">Created {formatRelativeTime(p.createdAt)}</p>

                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-border-subtle pt-3">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => handleRunSearch(p)} loading={searchingId === p.id}>
                    <Search className="size-3.5" />
                    Run search
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleting(p)} className="!text-red-600 hover:!bg-red-50">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="New ICP profile" description="Fields are comma-separated where multiple values apply.">
        <IcpProfileForm submitLabel="Create profile" onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit ICP profile">
        {editing && <IcpProfileForm initial={editing} submitLabel="Save changes" onSubmit={handleUpdate} onCancel={() => setEditing(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this profile?"
        description={deleting ? `"${deleting.name}" will be permanently removed. Leads already found using it are unaffected.` : undefined}
        confirmLabel="Delete"
        destructive
        loading={deleteBusy}
        onConfirm={handleDelete}
      />
    </div>
  );
}

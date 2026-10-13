import { useEffect, useState } from "react";
import { Sparkles, Pencil, ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { textareaClass, labelClass } from "../../components/ui/field";
import { ResearchStatusBadge } from "./StatusBadges";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import type { ResearchBrief } from "../../types";

interface Props {
  leadId: string;
  brief: ResearchBrief | null;
  onChanged: (brief: ResearchBrief) => void;
}

export function ResearchPanel({ leadId, brief, onChanged }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overviewDraft, setOverviewDraft] = useState("");
  const [painPointsDraft, setPainPointsDraft] = useState("");

  useEffect(() => {
    setOverviewDraft(brief?.companyOverview ?? "");
    setPainPointsDraft(brief?.painPoints.join("\n") ?? "");
    setEditing(false);
  }, [brief?.id, brief?.updatedAt]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const b = await api.generateResearchBrief(leadId, !!brief);
      onChanged(b);
      toast.push({ variant: "success", title: "Research complete" });
    } catch (e) {
      setError((e as Error).message);
      toast.push({ variant: "error", title: "Research failed", description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const b = await api.updateResearchBrief(leadId, {
        companyOverview: overviewDraft,
        painPoints: painPointsDraft.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      onChanged(b);
      setEditing(false);
      toast.push({ variant: "success", title: "Research saved" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Research</h3>
          <ResearchStatusBadge status={brief?.status} />
        </div>
        <div className="flex items-center gap-1.5">
          {brief && brief.status === "complete" && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={handleSave} loading={saving}>
                Save
              </Button>
            </>
          )}
          {!editing && (
            <Button size="sm" variant={brief ? "outline" : "secondary"} onClick={handleGenerate} loading={generating}>
              {brief ? <RotateCcw className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {brief ? "Regenerate" : "Run research"}
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {!brief && !generating && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-[13px] text-gray-500">No research yet for this lead.</p>
        </div>
      )}

      {brief?.status === "failed" && (
        <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          Research failed: {brief.error}
        </div>
      )}

      {brief && (brief.status === "complete" || brief.status === "failed") && (
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Company overview</label>
            {editing ? (
              <textarea
                className={textareaClass + " mt-1"}
                rows={3}
                value={overviewDraft}
                onChange={(e) => setOverviewDraft(e.target.value)}
              />
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-gray-700">
                {brief.companyOverview || <span className="text-gray-400">No overview.</span>}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass}>Pain points</label>
            {editing ? (
              <textarea
                className={textareaClass + " mt-1"}
                rows={4}
                placeholder="One per line"
                value={painPointsDraft}
                onChange={(e) => setPainPointsDraft(e.target.value)}
              />
            ) : brief.painPoints.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {brief.painPoints.map((p, i) => (
                  <li key={i} className="flex gap-1.5 text-[13px] text-gray-700">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gray-300" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-gray-400">None identified.</p>
            )}
          </div>

          {brief.recentNews.length > 0 && (
            <div>
              <label className={labelClass}>Recent news</label>
              <div className="mt-1.5 space-y-1.5">
                {brief.recentNews.map((n, i) => (
                  <a
                    key={i}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-border-subtle px-3 py-2 hover:border-gray-300 hover:bg-gray-50"
                  >
                    <p className="flex items-center gap-1 text-[12.5px] font-medium text-ink">
                      {n.title}
                      <ExternalLink className="size-3 shrink-0 text-gray-400" />
                    </p>
                    {n.summary && <p className="mt-0.5 text-xs text-gray-500">{n.summary}</p>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {brief.sources.length > 0 && (
            <div>
              <label className={labelClass}>Sources</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {brief.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

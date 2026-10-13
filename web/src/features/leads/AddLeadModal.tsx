import { useState } from "react";
import { Modal } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../components/ui/field";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import type { Lead } from "../../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (lead: Lead) => void;
}

export function AddLeadModal({ open, onOpenChange, onCreated }: Props) {
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFullName("");
    setTitle("");
    setCompany("");
    setEmail("");
    setLocation("");
    setLinkedinUrl("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) {
      setError("Full name is required");
      return;
    }
    setSaving(true);
    try {
      const lead = await api.createLead({
        fullName: fullName.trim(),
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        location: location.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
      });
      onCreated(lead);
      toast.push({ variant: "success", title: `${lead.fullName} added` });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Add lead"
      description="Manually add a contact. It flows through the same research, drafting, and send workflow as Apollo leads."
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        <div>
          <label className={labelClass}>Full name</label>
          <input className={inputClass + " mt-1"} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelClass}>Title</label>
            <input className={inputClass + " mt-1"} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <input className={inputClass + " mt-1"} value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" className={inputClass + " mt-1"} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <input className={inputClass + " mt-1"} value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelClass}>LinkedIn URL</label>
          <input className={inputClass + " mt-1"} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
        </div>

        <div className="flex justify-end pt-1">
          <Button type="submit" variant="primary" loading={saving}>
            Add lead
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from "react";

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export function useHealth(intervalMs = 30000): boolean | null {
  const [ok, setOk] = useState<boolean | null>(DEMO_MODE ? true : null);

  useEffect(() => {
    if (DEMO_MODE) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/health");
        if (!cancelled) setOk(res.ok);
      } catch {
        if (!cancelled) setOk(false);
      }
    }
    check();
    const id = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return ok;
}

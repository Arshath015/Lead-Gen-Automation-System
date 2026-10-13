import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { INDUSTRIES } from "./industry-select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  decodeIndustrySelection, encodeIndustrySelection, toggleIndustrySelection,
} from "@/lib/industry-filter-selection";

export function industryFilterOptions(selected: string[]) {
  return [...new Set<string>([...INDUSTRIES, ...selected])];
}

/** Filter-only picker. Lead editing and public submission remain single-select. */
export function IndustryFilter({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState(320);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = decodeIndustrySelection(value);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const bottom = triggerRef.current?.getBoundingClientRect().bottom ?? 0;
      setMaxHeight(Math.max(64, Math.min(320, window.innerHeight - bottom - 16)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const label = selected.length === 0 ? "All Industries"
    : selected.length === 1 ? selected[0] : `Industries (${selected.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant="outline" aria-label="Industry filter"
          className="h-9 w-[150px] justify-between gap-1 bg-background px-3 font-normal">
          <span className="truncate" title={selected.join(", ")}>{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} avoidCollisions={false}
        aria-label="Industry options" className="w-72 max-w-[calc(100vw-16px)] p-1">
        <div data-testid="industry-filter-options" role="group" aria-label="Industries"
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight }} onWheel={event => event.stopPropagation()}>
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent focus-within:bg-accent">
            <input type="checkbox" checked={selected.length === 0}
              onChange={() => onChange("")} className="h-4 w-4 accent-primary" />
            All Industries
          </label>
          <div className="my-1 border-t" />
          {industryFilterOptions(selected).map(industry => (
            <label key={industry}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent focus-within:bg-accent">
              <input type="checkbox" checked={selected.includes(industry)}
                onChange={() => onChange(encodeIndustrySelection(toggleIndustrySelection(selected, industry)))}
                className="h-4 w-4 shrink-0 accent-primary" />
              <span>{industry}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
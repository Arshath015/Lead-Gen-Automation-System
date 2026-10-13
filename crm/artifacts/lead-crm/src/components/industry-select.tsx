import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const INDUSTRIES = [
  "Fintech", "Manufacturing", "GCC", "BFSI", "Energy",
  "Startups", "Telecommunications", "BPO & BPM",
  "Healthcare & Wellness", "Pharmaceutical", "Others",
  "IT Services & Consulting", "Engineering", "Automotive",
  "Retail & FMCG", "E-Commerce",
] as const;

const EMPTY = "__no_industry__";

export function industryOptions(current: string) {
  return current && !INDUSTRIES.some(industry => industry === current)
    ? [...INDUSTRIES, current]
    : [...INDUSTRIES];
}

export function IndustrySelect({
  value, onChange, emptyLabel = "No industry", className, id,
}: {
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select value={value || EMPTY} onValueChange={next => onChange(next === EMPTY ? "" : next)}>
      <SelectTrigger id={id} aria-label="Industry" className={className}>
        <SelectValue placeholder="Industry" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>
        {industryOptions(value).map(industry => (
          <SelectItem key={industry} value={industry}>{industry}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
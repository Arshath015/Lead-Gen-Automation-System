import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from "date-fns";
import type { DateRange } from "react-day-picker";

export type DateRangePreset = "today" | "this_week" | "this_month" | "this_quarter" | "custom" | "all";

export type DateRangeValue = {
  from: string | undefined;
  to: string | undefined;
  preset: DateRangePreset;
};

const PRESETS: { label: string; value: DateRangePreset }[] = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "This Week", value: "this_week" },
  { label: "This Month", value: "this_month" },
  { label: "This Quarter", value: "this_quarter" },
  { label: "Custom", value: "custom" },
];

function getPresetRange(preset: DateRangePreset): { from: Date | undefined; to: Date | undefined } {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "this_week":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "this_quarter":
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    default:
      return { from: undefined, to: undefined };
  }
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (val: DateRangeValue) => void;
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handlePreset = (preset: DateRangePreset) => {
    if (preset === "custom") {
      setCalendarOpen(true);
      return;
    }
    const range = getPresetRange(preset);
    onChange({
      preset,
      from: range.from ? range.from.toISOString() : undefined,
      to: range.to ? range.to.toISOString() : undefined,
    });
  };

  const handleCustomSelect = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (range?.from && range?.to) {
      onChange({
        preset: "custom",
        from: startOfDay(range.from).toISOString(),
        to: endOfDay(range.to).toISOString(),
      });
      setCalendarOpen(false);
    }
  };

  const formatLabel = () => {
    if (value.preset === "custom" && value.from && value.to) {
      return `${format(new Date(value.from), "MMM d")} – ${format(new Date(value.to), "MMM d, yyyy")}`;
    }
    return PRESETS.find(p => p.value === value.preset)?.label ?? "All Time";
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
        {PRESETS.filter(p => p.value !== "custom").map(p => (
          <Button
            key={p.value}
            variant={value.preset === p.value ? "secondary" : "ghost"}
            size="sm"
            className={`h-7 text-xs ${value.preset === p.value ? "bg-primary/10 text-primary" : ""}`}
            onClick={() => handlePreset(p.value)}
          >
            {p.label}
          </Button>
        ))}
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={value.preset === "custom" ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 text-xs gap-1.5 ${value.preset === "custom" ? "bg-primary/10 text-primary" : ""}`}
              onClick={() => handlePreset("custom")}
            >
              <CalendarIcon className="h-3 w-3" />
              {value.preset === "custom" ? formatLabel() : "Custom"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={handleCustomSelect}
              numberOfMonths={2}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function useDefaultDateRange(): DateRangeValue {
  return { preset: "all", from: undefined, to: undefined };
}

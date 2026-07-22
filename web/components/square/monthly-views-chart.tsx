"use client";

// Square UI "marketing-dashboard" template monthly-views-chart, ported
// verbatim — same recharts AreaChart config, gradient fill, tooltip, axis
// treatment, card chrome, and the Time Period / Show Grid / Smooth Curve
// dropdown. Changes are parameterization only:
//   - the template's mock datasets (lastMonthData etc.) become the
//     `periodData` prop so the page supplies real series;
//   - title / series label / tooltip unit are props because our jobs carry
//     no per-view metric — the page feeds videos-published counts and
//     titles the chart accordingly;
//   - the y-axis rounding step scales with the data's magnitude (the
//     template hardcodes 50 000 steps, which collapses for small real
//     counts).

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { MoreVertical } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/square/ui/chart";
import { Button } from "@/components/square/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/square/ui/dropdown-menu";

export type Period = "1m" | "3m" | "6m" | "1y";

export interface ChartPoint {
  date: string;
  views: number;
}

const periodLabels: Record<Period, string> = {
  "1m": "Last month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "1y": "Last year",
};

function formatYAxis(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
  if (value >= 1000) return (value / 1000).toFixed(0) + "k";
  return value.toString();
}

export function MonthlyViewsChart({
  title,
  unit,
  periodData,
}: {
  /** Card title (template: "Monthly views"). */
  title: string;
  /** Tooltip unit suffix (template: "views"). */
  unit: string;
  /** Real series per period, derived by the page from live jobs data. */
  periodData: Record<Period, ChartPoint[]>;
}) {
  const [period, setPeriod] = useState<Period>("1m");
  const [showGrid, setShowGrid] = useState(true);
  const [smoothCurve, setSmoothCurve] = useState(true);

  const label = periodLabels[period];
  const data = periodData[period];

  const chartConfig = {
    views: {
      label: unit,
      color: "oklch(0.55 0.17 160)",
    },
  };

  const yMax = useMemo(() => {
    const max = Math.max(0, ...data.map((d) => d.views));
    // Template rounds to 50k steps; scale the step down for small real
    // series so the axis stays readable.
    const step = max >= 50000 ? 50000 : max >= 1000 ? 1000 : 5;
    return Math.max(step, Math.ceil(max / step) * step);
  }, [data]);

  const yMid = useMemo(() => {
    const round = yMax >= 2000 ? 1000 : 1;
    return Math.round(yMax / 2 / round) * round;
  }, [yMax]);

  const tickDates = useMemo(() => {
    const first = data[0]?.date ?? "";
    const mid = data[Math.floor(data.length / 2)]?.date ?? "";
    const last = data[data.length - 1]?.date ?? "";
    return new Set([first, mid, last]);
  }, [data]);

  const resetToDefault = () => {
    setPeriod("1m");
    setShowGrid(true);
    setSmoothCurve(true);
  };

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">
            {label}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Time Period</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(Object.entries(periodLabels) as [Period, string][]).map(
                  ([key, lbl]) => (
                    <DropdownMenuItem key={key} onClick={() => setPeriod(key)}>
                      {lbl} {period === key && "✓"}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showGrid}
              onCheckedChange={(v) => setShowGrid(!!v)}
            >
              Show Grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={smoothCurve}
              onCheckedChange={(v) => setSmoothCurve(!!v)}
            >
              Smooth Curve
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetToDefault}>
              Reset to Default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-[220px]">
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
            )}
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: string) => (tickDates.has(v) ? v : "")}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={formatYAxis}
              width={40}
              domain={[0, yMax]}
              ticks={[0, yMid, yMax]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [
                    `${Number(value).toLocaleString()} ${unit}`,
                    "",
                  ]}
                />
              }
            />
            <Area
              type={smoothCurve ? "monotone" : "linear"}
              dataKey="views"
              stroke="var(--color-views)"
              strokeWidth={2}
              fill="url(#viewsGradient)"
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--color-views)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}

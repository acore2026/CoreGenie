import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Colors } from "./colors";

type ChartData = { data: Record<string, string | number>[]; valueKey: string };
const numbers = new Intl.NumberFormat("zh-CN");
const tooltipStyle = {
  backgroundColor: "var(--theme-bg-primary)",
  color: "var(--theme-text-primary)",
};
const slices = [
  Colors.cyan,
  Colors.violet,
  Colors.rose,
  Colors.amber,
  Colors.emerald,
  Colors.teal,
  Colors.fuchsia,
];

export function SeriesLegend({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-end gap-2 mb-5 text-sm text-theme-text-primary">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: Colors.blue }}
      />
      {label}
    </div>
  );
}

export function SeriesChart({
  type,
  data,
  valueKey,
}: ChartData & { type: "area" | "bar" | "line" }) {
  const vertical = type === "bar";
  return (
    <ResponsiveContainer width="100%" height={type === "line" ? 400 : 350}>
      <ComposedChart data={data} layout={vertical ? "vertical" : "horizontal"}>
        <CartesianGrid strokeDasharray="3 3" />
        {vertical ? <XAxis type="number" /> : <XAxis dataKey="name" />}
        {vertical ? (
          <YAxis type="category" dataKey="name" width={100} />
        ) : (
          <YAxis />
        )}
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => numbers.format(Number(value))}
        />
        <Legend />
        {type === "area" && (
          <Area
            type="monotone"
            dataKey={valueKey}
            stroke={Colors.blue}
            fill={Colors.blue}
            fillOpacity={0.25}
          />
        )}
        {type === "bar" && <Bar dataKey={valueKey} fill={Colors.blue} />}
        {type === "line" && (
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={Colors.blue}
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, valueKey }: ChartData) {
  const total = data.reduce(
    (sum, row) => sum + (Number(row[valueKey]) || 0),
    0
  );
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey="name"
          innerRadius="65%"
          outerRadius="90%"
        >
          {data.map((row, i) => (
            <Cell
              key={i}
              fill={slices[i % slices.length]}
              name={String(row.name)}
            />
          ))}
          <Label
            position="center"
            value={numbers.format(total)}
            fill="var(--theme-text-primary)"
          />
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => numbers.format(Number(value))}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

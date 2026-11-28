import { Tooltip as RechartsTooltip } from "recharts";

function labelColor(hex: string) {
  let color = hex.replace(/^#/, "");
  if (color.length === 3)
    color = [...color].map((value) => value + value).join("");
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? "#FFFFFF" : "#000000";
}
export default function Tooltip({
  legendColor,
  ...props
}: { legendColor: string } & import("recharts").TooltipProps<
  number | string,
  string
>) {
  return (
    <RechartsTooltip
      wrapperStyle={{ outline: "none" }}
      isAnimationActive={false}
      cursor={{ fill: "#d1d5db", opacity: "0.15" }}
      position={{ y: 0 }}
      {...props}
      content={({ active, payload, label }) => {
        return active && payload ? (
          <div className="bg-theme-bg-primary text-sm rounded-md border shadow-lg">
            <div className="border-b py-2 px-4">
              <p className="text-theme-bg-primary font-medium">{label}</p>
            </div>
            <div className="space-y-1 py-2 px-4">
              {payload.map(({ value, name }, idx) => (
                <div
                  key={`id-${idx}`}
                  className="flex items-center justify-between space-x-8"
                >
                  <div className="flex items-center space-x-2">
                    <span
                      className="shrink-0 h-3 w-3 border-theme-bg-primary rounded-md rounded-full border-2 shadow-md"
                      style={{ backgroundColor: legendColor }}
                    />
                    <p
                      style={{
                        color: labelColor(legendColor),
                      }}
                      className="font-medium tabular-nums text-right whitespace-nowrap"
                    >
                      {value}
                    </p>
                  </div>
                  <p
                    style={{
                      color: labelColor(legendColor),
                    }}
                    className="whitespace-nowrap font-normal"
                  >
                    {name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      }}
    />
  );
}

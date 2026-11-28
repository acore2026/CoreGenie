interface CellProps {
  colors: string[];
  root?: { children?: unknown[] };
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
}
// Recharts supplies the layout when it clones the cell for a treemap node.
export default function CustomCell({
  root,
  depth = 0,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  index = 0,
  colors,
  name,
}: CellProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill:
            depth < 2
              ? colors[Math.floor((index / (root?.children?.length || 1)) * 6)]
              : "#ffffff00",
          stroke: "#fff",
          strokeWidth: 2 / (depth + 1e-10),
          strokeOpacity: 1 / (depth + 1e-10),
        }}
      />
      {depth === 1 ? (
        <text
          x={x + width / 2}
          y={y + height / 2 + 7}
          textAnchor="middle"
          fill="#fff"
          fontSize={14}
        >
          {name}
        </text>
      ) : null}
      {depth === 1 ? (
        <text x={x + 4} y={y + 18} fill="#fff" fontSize={16} fillOpacity={0.9}>
          {index + 1}
        </text>
      ) : null}
    </g>
  );
}

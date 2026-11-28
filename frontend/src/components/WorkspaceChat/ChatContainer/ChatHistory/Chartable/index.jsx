import { v4 } from "uuid";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Funnel,
  FunnelChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  Scatter,
  ScatterChart,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { Colors } from "./colors";
import { SeriesChart, DonutChart, SeriesLegend } from "./SeriesChart";
import CustomCell from "./CustomCell.jsx";
import Tooltip from "./CustomTooltip.jsx";
import { safeJsonParse } from "@/utils/request";
import renderMarkdown from "@/utils/chat/markdown.js";
import DOMPurify from "dompurify";
import { memo, useCallback, useState } from "react";
import { saveAs } from "file-saver";
import { useGenerateImage } from "recharts-to-png";
import { CircleNotch, DownloadSimple } from "@phosphor-icons/react";

export function Chartable({ props }) {
  const [getDivJpeg, { ref }] = useGenerateImage({
    quality: 1,
    type: "image/jpeg",
    options: {
      backgroundColor: "#393d43",
      padding: 20,
    },
  });
  const handleDownload = useCallback(async () => {
    const jpeg = await getDivJpeg();
    if (jpeg) saveAs(jpeg, `chart-${v4().split("-")[0]}.jpg`);
  }, []);

  const content =
    typeof props.content === "string"
      ? safeJsonParse(props.content, null)
      : props.content;
  if (!content || typeof content !== "object") return null;

  const chartType = content?.type?.toLowerCase();
  const data =
    typeof content.dataset === "string"
      ? safeJsonParse(content.dataset, [])
      : content.dataset;
  if (
    !Array.isArray(data) ||
    data.some((row) => !row || typeof row !== "object")
  )
    return null;
  const value =
    Object.keys(data[0] ?? {}).find((key) => key !== "name") ?? "value";
  const title = content?.title;

  const renderChart = () => {
    switch (chartType) {
      case "area":
      case "bar":
      case "line":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesChart type={chartType} data={data} valueKey={value} />
          </div>
        );
      case "composed":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <ComposedChart width={500} height={260} data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                tick={{ transform: "translate(0, 6)", fill: "white" }}
                style={{
                  fontSize: "12px",
                  fontFamily: "Inter; Helvetica",
                }}
                padding={{ left: 10, right: 10 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                type="number"
                tick={{ transform: "translate(-3, 0)", fill: "white" }}
                style={{
                  fontSize: "12px",
                  fontFamily: "Inter; Helvetica",
                }}
              />
              <Tooltip legendColor={Colors.blue} />
              <Line
                type="linear"
                dataKey={value}
                stroke={Colors.blue}
                dot={false}
                strokeWidth={2}
              />
              <Bar
                dataKey="value"
                name="value"
                type="linear"
                fill={Colors.blue}
              />
            </ComposedChart>
          </div>
        );
      case "scatter":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <ScatterChart width={500} height={260} data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                tick={{ transform: "translate(0, 6)", fill: "white" }}
                style={{
                  fontSize: "12px",
                  fontFamily: "Inter; Helvetica",
                }}
                padding={{ left: 10, right: 10 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                type="number"
                tick={{ transform: "translate(-3, 0)", fill: "white" }}
                style={{
                  fontSize: "12px",
                  fontFamily: "Inter; Helvetica",
                }}
              />
              <Tooltip legendColor={Colors.blue} />
              <Scatter dataKey={value} fill={Colors.blue} />
            </ScatterChart>
          </div>
        );
      case "pie":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <DonutChart data={data} valueKey={value} />
          </div>
        );
      case "radar":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <RadarChart
              cx={300}
              cy={250}
              outerRadius={150}
              width={600}
              height={500}
              data={data}
            >
              <PolarGrid />
              <PolarAngleAxis dataKey="name" tick={{ fill: "white" }} />
              <PolarRadiusAxis tick={{ fill: "white" }} />
              <Tooltip legendColor={Colors.blue} />
              <Radar
                dataKey="value"
                stroke={Colors.blue}
                fill={Colors.blue}
                fillOpacity={0.6}
              />
            </RadarChart>
          </div>
        );
      case "radialbar":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <RadialBarChart
              width={500}
              height={300}
              cx={150}
              cy={150}
              innerRadius={20}
              outerRadius={140}
              barSize={10}
              data={data}
            >
              <RadialBar
                angleAxisId={15}
                label={{
                  position: "insideStart",
                  fill: Colors.blue,
                }}
                dataKey="value"
              />
              <Tooltip legendColor={Colors.blue} />
            </RadialBarChart>
          </div>
        );
      case "treemap":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <Treemap
              width={500}
              height={260}
              data={data}
              dataKey="value"
              stroke="#fff"
              fill={Colors.blue}
              content={<CustomCell colors={Object.values(Colors)} />}
            >
              <Tooltip legendColor={Colors.blue} />
            </Treemap>
          </div>
        );
      case "funnel":
        return (
          <div className="bg-theme-bg-primary p-8 rounded-xl text-white light:border light:border-theme-border-primary">
            <h3 className="text-lg text-theme-text-primary font-medium">
              {title}
            </h3>
            <SeriesLegend label={value} />
            <FunnelChart width={500} height={300} data={data}>
              <Tooltip legendColor={Colors.blue} />
              <Funnel dataKey="value" color={Colors.blue} />
            </FunnelChart>
          </div>
        );
      default:
        return <p>Unsupported chart type.</p>;
    }
  };

  if (!!props.chatId) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-2 px-4 w-full flex flex-col md:max-w-[80%]">
          <div className="relative w-full">
            <DownloadGraph onClick={handleDownload} />
            <div ref={ref}>{renderChart()}</div>
            <span
              className="flex flex-col gap-y-1 mt-2"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(renderMarkdown(content.caption)),
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start w-full">
      <div className="py-2 px-4 w-full flex flex-col md:max-w-[80%]">
        <div className="relative w-full">
          <DownloadGraph onClick={handleDownload} />
          <div ref={ref}>{renderChart()}</div>
        </div>
        <span
          className="flex flex-col gap-y-1 mt-2"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(content.caption)),
          }}
        />
      </div>
    </div>
  );
}

function DownloadGraph({ onClick }) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    setLoading(true);
    await onClick?.();
    setLoading(false);
  };

  return (
    <div className="absolute top-3 right-3 z-50 cursor-pointer">
      <div className="flex flex-col items-center">
        <div className="p-1 rounded-full border-none">
          {loading ? (
            <CircleNotch
              className="text-theme-text-primary w-5 h-5 animate-spin"
              aria-label="Downloading image..."
            />
          ) : (
            <DownloadSimple
              weight="bold"
              className="text-theme-text-primary w-5 h-5 hover:text-theme-text-primary"
              onClick={handleClick}
              aria-label="Download graph image"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(Chartable);

import { useEffect, useRef, useState } from "react";
import "./plannedToolSketch.css";

export type PlannedTool = "documents" | "data" | "meetings";

function Documents() {
  return (
    <>
      <path fill="#e0bb7f" d="m50 36-1-14 27-2 8 7 37-1 5 38-70 2z" />
      <g className="tool-sketch-paper">
        <path fill="#fffdf4" d="m65 13 36-5 10 9 4 34-44 5z" />
        <path d="m101 9 1 10 9-2M76 25l19-2m-18 9 23-3m-22 10 13-2" />
      </g>
      <path fill="#ffd890" d="m48 38 30-2 5-5 47-2-7 34-70 3z" />
      <path d="m58 61 58-3" opacity=".42" />
      <path fill="#fff5d9" d="m89 40 23-1-1 8-23 1z" />
    </>
  );
}

function Data() {
  return (
    <>
      <path fill="#d9e9df" d="m48 18 75-3 2 46-75 3z" />
      <path fill="#fffdf4" d="m55 13 75 2-1 43-75-1z" />
      <path fill="#acd4bd" d="m55 13 75 2v11l-75-2z" />
      <path d="m55 36 74 2m-75 8 74 2M76 24l-1 32m26-31-1 32" opacity=".66" />
      <g className="tool-sketch-pencil">
        <path fill="#f8ce79" d="m100 48 25-28 6 5-26 28-8 3z" />
        <path fill="#f9e4c7" d="m100 48 5 5-8 3z" />
        <path d="m124 22 5 4" />
      </g>
    </>
  );
}

function Meetings() {
  return (
    <>
      <path fill="#e5d9ec" d="m52 20 59-4 5 45-61 3z" />
      <path fill="#fffdf4" d="m57 15 61 2-3 42-60-2z" />
      <path fill="#cbb4db" d="m58 15 60 2-1 10-61-2z" />
      <path d="m70 11-1 9m13-9-1 10m14-9-1 9m14-8-1 9" />
      <path d="m65 34 2 3 5-6m5 4 19 1m-32 8 2 3 5-6m6 4 14 1" />
      <g className="tool-sketch-note">
        <path fill="#ffe1a0" d="m99 35 29-3 3 22-7 8-23 2z" />
        <path d="m124 61-1-8 8 1m-24-11 13-2m-12 8 8-1" />
      </g>
    </>
  );
}

const drawings = { documents: Documents, data: Data, meetings: Meetings };

export default function PlannedToolSketch({ tool }: { tool: PlannedTool }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Drawing = drawings[tool];
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="tool-sketch"
      data-visible={visible}
    >
      <svg
        viewBox="0 0 180 78"
        fill="none"
        stroke="#403f3d"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d="m31 67 116-3m-94 5 35-1" opacity=".26" />
        <Drawing />
        <g transform="rotate(-4 40 56)">
          <path fill="#efa65f" d="m32 61 7-21 4-1 8 22z" />
          <path fill="#fff1d6" d="m36 50 9-1 2 5-13 1z" />
          <path fill="#efae69" d="m29 61 24-1 2 5-27 1z" />
        </g>
      </svg>
    </div>
  );
}

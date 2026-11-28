export type LocalToolId =
  "protocol-finder" | "api-cr-generator" | "tdoc-allocation" | "proposal-fill";

interface ToolLogoProps {
  tool: LocalToolId;
  size?: "sm" | "md";
}

function ProtocolFinderSvg() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      {/* Document sheet */}
      <path
        d="M11 8.5A2.5 2.5 0 0 1 13.5 6h12.2a2.5 2.5 0 0 1 1.77.73l5.8 5.8A2.5 2.5 0 0 1 34 14.3V37.5a2.5 2.5 0 0 1-2.5 2.5h-18A2.5 2.5 0 0 1 11 37.5v-29Z"
        fill="#ffffff"
        stroke="#0891b2"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M26.5 6.5V12a1.5 1.5 0 0 0 1.5 1.5h5.5"
        stroke="#0891b2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* PDF pill */}
      <rect x="14.5" y="13.5" width="13" height="6.5" rx="2" fill="#e1584b" />
      <text
        x="21"
        y="18.3"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="4.6"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        PDF
      </text>
      {/* Spec text lines */}
      <path
        d="M15 24.5h12M15 29h8.5M15 33.5h6.5"
        stroke="#64748b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Magnifying glass */}
      <circle
        cx="31.5"
        cy="31"
        r="6.2"
        fill="#ecfeff"
        stroke="#0284c7"
        strokeWidth="2.2"
      />
      {/* 3GPP wireless arc inside lens */}
      <path
        d="M29.2 31.8a3.2 3.2 0 0 1 4.6 0M30.5 33.2a1.4 1.4 0 0 1 2 0"
        stroke="#0891b2"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="m36.1 35.6 4.4 4.4"
        stroke="#0284c7"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProposalFillSvg() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      {/* Back sheet (list / table) */}
      <rect
        x="8.5"
        y="11"
        width="21"
        height="27"
        rx="2.5"
        fill="#f0f9ff"
        stroke="#0284c7"
        strokeWidth="1.8"
      />
      <path
        d="M12.5 17h10M12.5 22h8M12.5 27h9"
        stroke="#7dd3fc"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Front Word proposal sheet */}
      <path
        d="M17 8.5A2.5 2.5 0 0 1 19.5 6h14.2a2.5 2.5 0 0 1 1.77.73l3.8 3.8A2.5 2.5 0 0 1 40 12.3V37.5a2.5 2.5 0 0 1-2.5 2.5h-18A2.5 2.5 0 0 1 17 37.5v-29Z"
        fill="#ffffff"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* TDoc ID tag pill */}
      <rect x="20.5" y="13" width="15.5" height="7" rx="2" fill="#dbeafe" />
      <path
        d="M23.5 16.5h9.5"
        stroke="#2563eb"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Document body lines */}
      <path
        d="M21 24.5h14M21 29h9"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Verified fill badge */}
      <circle
        cx="34.5"
        cy="34.5"
        r="6.5"
        fill="#10b981"
        stroke="#ffffff"
        strokeWidth="1.8"
      />
      <path
        d="m31.6 34.6 2 2 4-4.2"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ApiCrGeneratorSvg() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      <rect
        x="8"
        y="9"
        width="20"
        height="25"
        rx="2.5"
        fill="#ecfdf5"
        stroke="#059669"
        strokeWidth="1.8"
      />
      <path
        d="M12 15h12M12 20h12M12 25h8M18 15v14"
        stroke="#6ee7b7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19 11.5A2.5 2.5 0 0 1 21.5 9h12.2a2.5 2.5 0 0 1 1.77.73l3.8 3.8A2.5 2.5 0 0 1 40 15.3V37.5a2.5 2.5 0 0 1-2.5 2.5h-16A2.5 2.5 0 0 1 19 37.5v-26Z"
        fill="#ffffff"
        stroke="#0d9488"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="22.5" y="15" width="14" height="6.5" rx="2" fill="#ccfbf1" />
      <text
        x="29.5"
        y="19.6"
        textAnchor="middle"
        fill="#0f766e"
        fontSize="5"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        CR
      </text>
      <path
        d="M23 26.5h13M23 31h9M23 35h11"
        stroke="#64748b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TdocAllocationSvg() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      <path
        d="M9 10.5A2.5 2.5 0 0 1 11.5 8h13a2.5 2.5 0 0 1 2.5 2.5v23a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 9 33.5v-23Z"
        fill="#ffffff"
        stroke="#6366f1"
        strokeWidth="1.9"
      />
      <path
        d="M13 15h10M13 20h10M13 25h7"
        stroke="#a5b4fc"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="19"
        y="15"
        width="21"
        height="24"
        rx="2.5"
        fill="#ffffff"
        stroke="#16a34a"
        strokeWidth="2"
      />
      <rect x="21" y="17" width="17" height="5" rx="1" fill="#dcfce7" />
      <path
        d="M22 26h15M22 30.5h15M22 35h15M28.5 22v15"
        stroke="#16a34a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STYLES: Record<LocalToolId, string> = {
  "protocol-finder": "border-cyan-500/25 bg-cyan-500/10",
  "api-cr-generator": "border-teal-500/25 bg-teal-500/10",
  "tdoc-allocation": "border-emerald-500/25 bg-emerald-500/10",
  "proposal-fill": "border-blue-500/25 bg-blue-500/10",
};

const ICONS: Record<LocalToolId, () => JSX.Element> = {
  "protocol-finder": ProtocolFinderSvg,
  "api-cr-generator": ApiCrGeneratorSvg,
  "tdoc-allocation": TdocAllocationSvg,
  "proposal-fill": ProposalFillSvg,
};

export default function ToolLogo({ tool, size = "md" }: ToolLogoProps) {
  const box =
    size === "sm" ? "h-11 w-11 p-1.5 rounded-xl" : "h-12 w-12 p-1.5 rounded-xl";
  const Icon = ICONS[tool];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border ${box} ${STYLES[tool]}`}
    >
      <Icon />
    </span>
  );
}

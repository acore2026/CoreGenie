import { useTranslation } from "react-i18next";
import huaweiLogo from "@/media/release-notes/huawei-logo.png";

const INK = "#1e293b";
const MUTED = "#475569";
const HAND_FONT =
  '"Virgil", "Segoe Print", "Bradley Hand", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const MONO_FONT =
  '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

function Paper({
  name,
  viewBox = "0 0 560 270",
  className = "block h-auto w-full rounded-xl border border-black/10 bg-[#fdfcf8]",
  children,
}: React.PropsWithChildren<{
  name: string;
  viewBox?: string;
  className?: string;
}>) {
  const { t } = useTranslation();
  const id = `sk-${name}`;
  return (
    <svg
      role="img"
      aria-label={t(`help.november_release.sketch.${name}`)}
      viewBox={viewBox}
      className={className}
      fill="none"
      stroke={INK}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fontFamily={HAND_FONT}
      textAnchor="middle"
    >
      <defs>
        <pattern
          id={`${id}-dots`}
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="0.85" fill="#d6d3c8" stroke="none" />
        </pattern>
        <pattern
          id={`${id}-hatch-green`}
          width="8"
          height="8"
          patternTransform="rotate(42)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#ecfdf5" stroke="none" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#bbf7d0"
            strokeWidth="2.4"
          />
        </pattern>
        <pattern
          id={`${id}-hatch-cyan`}
          width="8"
          height="8"
          patternTransform="rotate(-38)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#ecfeff" stroke="none" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#bae6fd"
            strokeWidth="2.4"
          />
        </pattern>
        <pattern
          id={`${id}-hatch-amber`}
          width="8"
          height="8"
          patternTransform="rotate(42)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#fffbeb" stroke="none" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#fde68a"
            strokeWidth="2.4"
          />
        </pattern>
        <pattern
          id={`${id}-hatch-blue`}
          width="8"
          height="8"
          patternTransform="rotate(-42)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#eff6ff" stroke="none" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#bfdbfe"
            strokeWidth="2.4"
          />
        </pattern>
        <pattern
          id={`${id}-hatch-purple`}
          width="8"
          height="8"
          patternTransform="rotate(40)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#f5f3ff" stroke="none" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#ddd6fe"
            strokeWidth="2.4"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="#fdfcf8" stroke="none" />
      <rect
        width="100%"
        height="100%"
        fill={`url(#${id}-dots)`}
        stroke="none"
      />
      {children}
    </svg>
  );
}

/**
 * Excalidraw-style slightly organic rounded rectangle with subtle double-stroke pass.
 */
function SketchRect({
  x,
  y,
  w,
  h,
  r = 12,
  fill = "#ffffff",
  stroke = INK,
  strokeWidth = 2,
  dashed = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
}) {
  const dash = dashed ? "7 5" : undefined;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      {!dashed && (
        <rect
          x={x + 1.2}
          y={y - 0.8}
          width={w - 1.5}
          height={h + 1}
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(1, strokeWidth - 0.9)}
          opacity="0.32"
        />
      )}
    </g>
  );
}

function Label({
  x,
  y,
  children,
  size = 15,
  fill = INK,
  weight = 600,
  mono = false,
  anchor = "middle",
}: React.PropsWithChildren<{
  x: number;
  y: number;
  size?: number;
  fill?: string;
  weight?: number;
  mono?: boolean;
  anchor?: "start" | "middle" | "end";
}>) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      fontFamily={mono ? MONO_FONT : HAND_FONT}
      textAnchor={anchor}
      stroke="none"
      fill={fill}
    >
      {children}
    </text>
  );
}

function Pill({
  x,
  y,
  w,
  h = 24,
  fill = "#fdfcf8",
  stroke = "#94a3b8",
  text,
  textColor = INK,
  size = 12.5,
  mono = false,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  fill?: string;
  stroke?: string;
  text: string;
  textColor?: string;
  size?: number;
  mono?: boolean;
}) {
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      <Label x={x} y={y + 4.5} size={size} fill={textColor} mono={mono}>
        {text}
      </Label>
    </g>
  );
}

function StepDot({
  x,
  y,
  n,
  fill = "#0891b2",
}: {
  x: number;
  y: number;
  n: number;
  fill?: string;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r="10.5"
        fill={fill}
        stroke={INK}
        strokeWidth="1.4"
      />
      <Label x={x} y={y + 4} size={12} fill="#ffffff" weight={700}>
        {n}
      </Label>
    </g>
  );
}

export function DeploymentSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper name="deployment" viewBox="0 0 560 272">
      {/* Green Zone Container */}
      <SketchRect
        x={16}
        y={16}
        w={528}
        h={168}
        r={16}
        fill="url(#sk-deployment-hatch-green)"
        stroke="#2f855a"
        strokeWidth={2.2}
      />
      {/* Top-left Zone Badge */}
      <rect
        x={30}
        y={8}
        width={88}
        height={24}
        rx={8}
        fill="#15803d"
        stroke={INK}
        strokeWidth="1.5"
      />
      <Label x={74} y={24.5} size={13} fill="#ffffff" weight={700}>
        {t("green")}
      </Label>

      {/* Node 1: Laptop */}
      <g transform="translate(30, 66)">
        {/* Screen */}
        <SketchRect
          x={12}
          y={4}
          w={68}
          h={44}
          r={6}
          fill="#ffffff"
          stroke={INK}
          strokeWidth={2}
        />
        <rect
          x={18}
          y={10}
          width={56}
          height={32}
          rx={3}
          fill="#e0f2fe"
          stroke="#64748b"
          strokeWidth="1.2"
        />
        {/* Window header dots on screen */}
        <circle cx={23} cy={15} r="1.4" fill="#64748b" stroke="none" />
        <circle cx={28} cy={15} r="1.4" fill="#64748b" stroke="none" />
        <path
          d="M23 24 L56 24 M23 31 L46 31"
          stroke="#0284c7"
          strokeWidth="1.8"
        />
        {/* Keyboard base */}
        <path
          d="M11 48 L81 48 L91 58 Q46 62 1 58 Z"
          fill="#cbd5e1"
          stroke={INK}
          strokeWidth="2"
        />
        <path d="M35 53 L57 53" stroke="#64748b" strokeWidth="1.6" />
      </g>
      <Label x={76} y={148} size={15} fill={INK}>
        {t("laptop")}
      </Label>

      {/* Arrow 1: Laptop -> Server */}
      <path d="M128 100 Q186 94 238 100" stroke="#15803d" strokeWidth="2.3" />
      <path d="M229 94 L240 100 L229 106" stroke="#15803d" strokeWidth="2.3" />
      <Pill
        x={208}
        y={42}
        w={166}
        h={22}
        fill="#ffffff"
        stroke="#86efac"
        text="aicore.tool.huawei.com"
        textColor="#166534"
        size={10.8}
        mono
      />

      {/* Node 2: CoreGenie Linux Server */}
      <g transform="translate(248, 60)">
        <SketchRect
          x={0}
          y={4}
          w={92}
          h={28}
          r={7}
          fill="#ffffff"
          stroke={INK}
          strokeWidth={2}
        />
        <SketchRect
          x={0}
          y={37}
          w={92}
          h={28}
          r={7}
          fill="#d1fae5"
          stroke={INK}
          strokeWidth={2}
        />
        {/* Rack vents & LEDs */}
        <path
          d="M12 18 L44 18 M12 51 L44 51"
          stroke="#475569"
          strokeWidth="2.2"
        />
        <circle
          cx={70}
          cy={18}
          r="3"
          fill="#22c55e"
          stroke={INK}
          strokeWidth="1.2"
        />
        <circle cx={81} cy={18} r="2.2" fill="#94a3b8" stroke="none" />
        <circle
          cx={70}
          cy={51}
          r="3"
          fill="#06b6d4"
          stroke={INK}
          strokeWidth="1.2"
        />
        <circle cx={81} cy={51} r="2.2" fill="#94a3b8" stroke="none" />
      </g>
      <Label x={294} y={148} size={15.5} fill={INK} weight={700}>
        CoreGenie
      </Label>
      <Label x={294} y={168} size={12.5} fill="#166534" weight={500}>
        {t("server")}
      </Label>

      {/* Arrow 2: Server -> Models */}
      <path d="M348 100 Q382 95 418 100" stroke="#15803d" strokeWidth="2.3" />
      <path d="M409 94 L420 100 L409 106" stroke="#15803d" strokeWidth="2.3" />

      {/* Node 3: Internal AI Models (Neural / Chip icon) */}
      <g transform="translate(428, 58)">
        <SketchRect
          x={6}
          y={4}
          w={74}
          h={62}
          r={14}
          fill="url(#sk-deployment-hatch-amber)"
          stroke="#b45309"
          strokeWidth={2}
        />
        {/* Neural network connections */}
        <path
          d="M24 23 L43 35 L62 23 M24 47 L43 35 L62 47 M24 23 L24 47 M62 23 L62 47"
          stroke="#b45309"
          strokeWidth="1.6"
        />
        <circle
          cx={24}
          cy={23}
          r="4.5"
          fill="#ffffff"
          stroke="#b45309"
          strokeWidth="1.8"
        />
        <circle
          cx={24}
          cy={47}
          r="4.5"
          fill="#ffffff"
          stroke="#b45309"
          strokeWidth="1.8"
        />
        <circle
          cx={62}
          cy={23}
          r="4.5"
          fill="#ffffff"
          stroke="#b45309"
          strokeWidth="1.8"
        />
        <circle
          cx={62}
          cy={47}
          r="4.5"
          fill="#ffffff"
          stroke="#b45309"
          strokeWidth="1.8"
        />
        <circle
          cx={43}
          cy={35}
          r="6"
          fill="#fef3c7"
          stroke="#b45309"
          strokeWidth="2"
        />
      </g>
      <Label x={471} y={148} size={15} fill={INK}>
        {t("models")}
      </Label>
      <Label x={471} y={168} size={11.5} fill="#92400e" mono>
        {t("modelsSub")}
      </Label>

      {/* Bottom Row: Yellow Zone & Blue Zone */}
      {/* Yellow Zone: Blocked */}
      <g transform="translate(16, 198)">
        <SketchRect
          x={0}
          y={0}
          w={254}
          h={58}
          r={12}
          fill="url(#sk-deployment-hatch-amber)"
          stroke="#d97706"
          strokeWidth={1.9}
        />
        {/* Blocked icon */}
        <circle
          cx={32}
          cy={29}
          r="13"
          fill="#fff7ed"
          stroke="#dc2626"
          strokeWidth="2"
        />
        <path d="M24 21 L40 37" stroke="#dc2626" strokeWidth="2.2" />
        <Label x={58} y={25} size={14.5} fill={INK} anchor="start">
          {t("yellow")}
        </Label>
        <Label
          x={58}
          y={45}
          size={12.5}
          fill="#92400e"
          weight={500}
          anchor="start"
        >
          {t("blocked")}
        </Label>
      </g>

      {/* Blue Zone: Still available */}
      <g transform="translate(290, 198)">
        <SketchRect
          x={0}
          y={0}
          w={254}
          h={58}
          r={12}
          fill="url(#sk-deployment-hatch-blue)"
          stroke="#2563eb"
          strokeWidth={1.9}
        />
        {/* Check icon */}
        <circle
          cx={32}
          cy={29}
          r="13"
          fill="#eff6ff"
          stroke="#16a34a"
          strokeWidth="2"
        />
        <path d="M25 29 L30 34 L40 23" stroke="#16a34a" strokeWidth="2.3" />
        <Label x={58} y={25} size={14.5} fill={INK} anchor="start">
          {t("blue")}
        </Label>
        <Label
          x={58}
          y={45}
          size={12.5}
          fill="#1d4ed8"
          weight={500}
          anchor="start"
        >
          {t("available")}
        </Label>
      </g>
    </Paper>
  );
}

export function SignInSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper name="signin" viewBox="0 0 560 272">
      {/* Left: CoreGenie Browser Window */}
      <g transform="translate(24, 68)">
        <SketchRect
          x={0}
          y={0}
          w={164}
          h={114}
          r={12}
          fill="url(#sk-signin-hatch-cyan)"
          stroke="#0284c7"
          strokeWidth={2}
        />
        {/* Browser top bar */}
        <path d="M2 24 L162 24" stroke="#0284c7" strokeWidth="1.6" />
        <circle cx={14} cy={12} r="2.8" fill="#f87171" stroke="none" />
        <circle cx={24} cy={12} r="2.8" fill="#fbbf24" stroke="none" />
        <circle cx={34} cy={12} r="2.8" fill="#4ade80" stroke="none" />
        <Label x={82} y={56} size={18} fill={INK} weight={700}>
          CoreGenie
        </Label>
        {/* Login button inside window */}
        <rect
          x={26}
          y={72}
          width={112}
          height={28}
          rx={7}
          fill="#0284c7"
          stroke={INK}
          strokeWidth="1.4"
        />
        <Label x={82} y={90.5} size={12.5} fill="#ffffff" weight={600}>
          {t("loginBtn")}
        </Label>
      </g>
      {/* Step 1 badge */}
      <StepDot x={62} y={204} n={1} fill="#0284c7" />
      <Label x={112} y={209} size={14} fill={INK}>
        {t("start")}
      </Label>

      {/* Right: Huawei IDaaS Card */}
      <g transform="translate(372, 68)">
        <SketchRect
          x={0}
          y={0}
          w={164}
          h={114}
          r={12}
          fill="#ffffff"
          stroke="#334155"
          strokeWidth={2}
        />
        {/* Top accent strip */}
        <rect
          x={52}
          y={-8}
          width={60}
          height={16}
          rx={5}
          fill="#fee2e2"
          stroke="#dc2626"
          strokeWidth="1.5"
        />
        <Label x={82} y={4} size={10} fill="#991b1b" weight={700}>
          SSO
        </Label>
        <image href={huaweiLogo} x={27} y={24} width={110} height={28} />
        <path d="M22 64 L142 64" stroke="#e2e8f0" strokeWidth="1.5" />
        <Label x={82} y={84} size={16} fill={INK} weight={700}>
          IDaaS
        </Label>
        <Label x={82} y={102} size={11.5} fill={MUTED} weight={500}>
          {t("idaasSub")}
        </Label>
      </g>
      {/* Step 3 badge */}
      <StepDot x={402} y={204} n={3} fill="#dc2626" />
      <Label x={462} y={209} size={14} fill={INK}>
        {t("authenticate")}
      </Label>

      {/* Top Arrow: Step 2 Redirect */}
      <path d="M174 62 Q280 8 386 60" stroke="#0284c7" strokeWidth="2.4" />
      <path d="M376 49 L388 61 L371 61" stroke="#0284c7" strokeWidth="2.4" />
      <g transform="translate(280, 34)">
        <rect
          x={-68}
          y={-13}
          width={136}
          height={26}
          rx={13}
          fill="#ffffff"
          stroke="#7dd3fc"
          strokeWidth="1.6"
        />
        <StepDot x={-53} y={0} n={2} fill="#0284c7" />
        <Label x={10} y={4.5} size={13} fill="#0369a1">
          {t("redirect")}
        </Label>
      </g>

      {/* Bottom Arrow: Step 4 Return */}
      <path d="M380 228 Q280 264 180 228" stroke="#15803d" strokeWidth="2.4" />
      <path d="M191 238 L178 227 L195 225" stroke="#15803d" strokeWidth="2.4" />
      <g transform="translate(280, 240)">
        <rect
          x={-74}
          y={-13}
          width={148}
          height={26}
          rx={13}
          fill="#ffffff"
          stroke="#86efac"
          strokeWidth="1.6"
        />
        <StepDot x={-59} y={0} n={4} fill="#15803d" />
        <Label x={10} y={4.5} size={13} fill="#166534">
          {t("return")}
        </Label>
      </g>
    </Paper>
  );
}

export function ProposalFillSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper
      name="proposal"
      viewBox="0 0 560 280"
      className="block h-full w-full bg-[#fdfcf8]"
    >
      {/* Input 1: Meeting List (Excel) */}
      <g transform="translate(18, 26)">
        <SketchRect
          x={0}
          y={0}
          w={164}
          h={96}
          r={12}
          fill="url(#sk-proposal-hatch-green)"
          stroke="#15803d"
          strokeWidth={2}
        />
        {/* Mini spreadsheet grid */}
        <rect
          x={14}
          y={14}
          width={34}
          height={30}
          rx={4}
          fill="#ffffff"
          stroke="#15803d"
          strokeWidth="1.5"
        />
        <path
          d="M14 23 L48 23 M14 33 L48 33 M26 14 L26 44"
          stroke="#15803d"
          strokeWidth="1.2"
        />
        <Label x={58} y={29} size={14.5} fill={INK} anchor="start">
          {t("proposalList")}
        </Label>
        <Label
          x={58}
          y={46}
          size={11}
          fill="#166534"
          weight={500}
          anchor="start"
        >
          {t("proposalListSub")}
        </Label>
        {/* Mini table preview bar */}
        <rect
          x={10}
          y={56}
          width={144}
          height={26}
          rx={5}
          fill="#ffffff"
          stroke="#86efac"
          strokeWidth="1.3"
        />
        <Label x={82} y={73} size={9.2} fill="#166534" mono>
          C4-265196 | 0419 | 20.1.0
        </Label>
      </g>

      {/* Input 2: Word Drafts */}
      <g transform="translate(18, 150)">
        {/* Stacked paper shadow behind */}
        <rect
          x={6}
          y={6}
          width={160}
          height={96}
          rx={12}
          fill="#fef3c7"
          stroke="#d97706"
          strokeWidth="1.5"
          opacity="0.6"
        />
        <SketchRect
          x={0}
          y={0}
          w={164}
          h={98}
          r={12}
          fill="url(#sk-proposal-hatch-amber)"
          stroke="#b45309"
          strokeWidth={2}
        />
        {/* Mini Word doc icon */}
        <rect
          x={14}
          y={14}
          width={30}
          height={36}
          rx={4}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth="1.6"
        />
        <Label x={29} y={37} size={14} fill="#2563eb" weight={700}>
          W
        </Label>
        <Label x={54} y={30} size={14.5} fill={INK} anchor="start">
          {t("proposalDraft")}
        </Label>
        <Label
          x={54}
          y={47}
          size={11}
          fill="#92400e"
          weight={500}
          anchor="start"
        >
          {t("proposalDraftSub")}
        </Label>
        <rect
          x={14}
          y={59}
          width={136}
          height={26}
          rx={5}
          fill="#ffffff"
          stroke="#fcd34d"
          strokeWidth="1.3"
        />
        <Label x={82} y={76} size={11.5} fill="#92400e" mono>
          C4-26xxxx.docx
        </Label>
      </g>

      {/* Converging arrows to Center Engine */}
      <path d="M186 76 Q208 82 220 112" stroke="#15803d" strokeWidth="2.2" />
      <path d="M211 107 L221 114 L221 102" stroke="#15803d" strokeWidth="2.2" />

      <path d="M186 198 Q208 192 220 164" stroke="#b45309" strokeWidth="2.2" />
      <path d="M221 175 L221 162 L211 169" stroke="#b45309" strokeWidth="2.2" />

      {/* Center: Local Matching & Fill Engine */}
      <g transform="translate(216, 86)">
        <SketchRect
          x={0}
          y={0}
          w={96}
          h={102}
          r={16}
          fill="url(#sk-proposal-hatch-cyan)"
          stroke="#0284c7"
          strokeWidth={2.2}
        />
        {/* Sparkle / Magic match icon */}
        <path
          d="M48 16 L51 25 L60 28 L51 31 L48 40 L45 31 L36 28 L45 25 Z"
          fill="#fef08a"
          stroke="#0284c7"
          strokeWidth="1.6"
        />
        <Label x={48} y={62} size={14.5} fill="#0c4a6e" weight={700}>
          {t("proposalMatch")}
        </Label>
        <Label x={48} y={84} size={14.5} fill="#0c4a6e" weight={700}>
          {t("proposalFill")}
        </Label>
      </g>
      {/* Local badge under center */}
      <Pill
        x={264}
        y={212}
        w={122}
        h={22}
        fill="#ffffff"
        stroke="#7dd3fc"
        text={t("proposalLocal")}
        textColor="#0369a1"
        size={11}
      />

      {/* Output arrow */}
      <path d="M316 137 L370 137" stroke="#0284c7" strokeWidth="2.4" />
      <path d="M361 130 L372 137 L361 144" stroke="#0284c7" strokeWidth="2.4" />
      <Label x={343} y={123} size={10.5} fill="#0369a1">
        {t("proposalExport")}
      </Label>

      {/* Output: Formal Renamed Word Copy */}
      <g transform="translate(376, 40)">
        <SketchRect
          x={0}
          y={0}
          w={166}
          h={198}
          r={14}
          fill="url(#sk-proposal-hatch-blue)"
          stroke="#1d4ed8"
          strokeWidth={2.2}
        />
        {/* Green Check Badge top-right */}
        <circle
          cx={154}
          cy={12}
          r="13"
          fill="#22c55e"
          stroke={INK}
          strokeWidth="1.6"
        />
        <path
          d="M148 12 L152.5 16.5 L161 8"
          stroke="#ffffff"
          strokeWidth="2.4"
        />

        <Label x={83} y={28} size={14.5} fill="#1e3a8a" weight={700}>
          {t("proposalOutput")}
        </Label>

        {/* Highlighted Output Filename */}
        <rect
          x={14}
          y={40}
          width={138}
          height={32}
          rx={7}
          fill="#ffffff"
          stroke="#60a5fa"
          strokeWidth="1.6"
        />
        {/* Highlighter stroke behind number */}
        <rect
          x={54}
          y={46}
          width={54}
          height={20}
          rx={4}
          fill="#fef08a"
          stroke="none"
        />
        <Label x={83} y={60.5} size={12.5} fill="#1e3a8a" weight={700} mono>
          C4-265196.docx
        </Label>

        {/* Checklist of filled fields */}
        <g transform="translate(18, 90)">
          <rect
            x={0}
            y={0}
            width={130}
            height={92}
            rx={8}
            fill="#ffffff"
            stroke="#bfdbfe"
            strokeWidth="1.3"
          />
          <path d="M10 21 L14 25 L22 16" stroke="#16a34a" strokeWidth="2.2" />
          <Label x={29} y={24} size={12} fill={INK} anchor="start">
            {t("proposalCheck1")}
          </Label>

          <path d="M10 49 L14 53 L22 44" stroke="#16a34a" strokeWidth="2.2" />
          <Label x={29} y={52} size={12} fill={INK} anchor="start">
            {t("proposalCheck2")}
          </Label>

          <path d="M10 77 L14 81 L22 72" stroke="#16a34a" strokeWidth="2.2" />
          <Label x={29} y={80} size={12} fill={INK} anchor="start">
            {t("proposalCheck3")}
          </Label>
        </g>
      </g>
    </Paper>
  );
}

export function IdeasSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper name="ideas" viewBox="0 0 560 248">
      {/* Subtle connecting flow dashes behind notes */}
      <path
        d="M168 124 Q194 114 214 126"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeDasharray="5 5"
      />
      <path
        d="M350 128 Q374 138 394 122"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeDasharray="5 5"
      />

      {/* Sticky Note 1: Find Materials */}
      <g transform="translate(26, 46) rotate(-3 72 72)">
        <SketchRect
          x={0}
          y={0}
          w={144}
          h={146}
          r={10}
          fill="url(#sk-ideas-hatch-amber)"
          stroke="#d97706"
          strokeWidth={2}
        />
        {/* Washi tape */}
        <rect
          x={46}
          y={-10}
          width={52}
          height={18}
          rx={3}
          fill="#fef3c7"
          stroke="#b45309"
          strokeWidth="1.2"
          opacity="0.9"
        />
        {/* Document + Magnifying glass icon */}
        <rect
          x={44}
          y={28}
          width={38}
          height={46}
          rx={4}
          fill="#ffffff"
          stroke={INK}
          strokeWidth="1.8"
        />
        <path
          d="M52 40 L74 40 M52 50 L70 50 M52 60 L64 60"
          stroke="#64748b"
          strokeWidth="1.6"
        />
        <circle
          cx={88}
          cy={58}
          r="13"
          fill="#fef9c3"
          stroke="#b45309"
          strokeWidth="2.2"
        />
        <path d="M97 67 L107 77" stroke="#b45309" strokeWidth="3" />
        <Label x={72} y={118} size={17} fill={INK}>
          {t("find")}
        </Label>
      </g>

      {/* Sticky Note 2: Checklists */}
      <g transform="translate(208, 52) rotate(2 72 72)">
        <SketchRect
          x={0}
          y={0}
          w={144}
          h={146}
          r={10}
          fill="url(#sk-ideas-hatch-green)"
          stroke="#15803d"
          strokeWidth={2}
        />
        {/* Washi tape */}
        <rect
          x={46}
          y={-10}
          width={52}
          height={18}
          rx={3}
          fill="#dcfce7"
          stroke="#15803d"
          strokeWidth="1.2"
          opacity="0.9"
        />
        {/* Checklist icon */}
        <rect
          x={36}
          y={26}
          width={72}
          height={54}
          rx={6}
          fill="#ffffff"
          stroke={INK}
          strokeWidth="1.8"
        />
        <path d="M46 42 L51 47 L60 36" stroke="#16a34a" strokeWidth="2.3" />
        <path d="M68 42 L96 42" stroke="#475569" strokeWidth="2" />
        <path d="M46 62 L51 67 L60 56" stroke="#16a34a" strokeWidth="2.3" />
        <path d="M68 62 L92 62" stroke="#475569" strokeWidth="2" />
        <Label x={72} y={118} size={17} fill={INK}>
          {t("check")}
        </Label>
      </g>

      {/* Sticky Note 3: Your Idea? */}
      <g transform="translate(390, 44) rotate(-2.5 72 72)">
        <SketchRect
          x={0}
          y={0}
          w={144}
          h={146}
          r={10}
          fill="url(#sk-ideas-hatch-purple)"
          stroke="#7c3aed"
          strokeWidth={2}
          dashed
        />
        {/* Lightbulb icon */}
        <path
          d="M72 26 C57 26 49 36 49 48 C49 56 54 62 59 67 L59 74 L85 74 L85 67 C90 62 95 56 95 48 C95 36 87 26 72 26 Z"
          fill="#fef08a"
          stroke="#7c3aed"
          strokeWidth="2"
        />
        <path
          d="M63 80 L81 80 M66 85 L78 85"
          stroke="#7c3aed"
          strokeWidth="2"
        />
        {/* Rays */}
        <path
          d="M72 14 L72 19 M40 35 L45 38 M104 35 L99 38 M38 52 L43 52 M106 52 L101 52"
          stroke="#9333ea"
          strokeWidth="1.8"
        />
        <Label x={72} y={114} size={17} fill="#5b21b6" weight={700}>
          {t("yourIdea")}
        </Label>
        <Label x={72} y={134} size={11.5} fill="#7c3aed" weight={500}>
          {t("welcomeIdea")}
        </Label>
      </g>
    </Paper>
  );
}

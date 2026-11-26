import { useTranslation } from "react-i18next";
import huaweiLogo from "@/media/release-notes/huawei-logo.png";

const ink = "#303a3b";
const handwriting =
  '"Kaiti SC", "KaiTi", "STKaiti", "Comic Sans MS", system-ui, sans-serif';

function Paper({ name, children }) {
  const { t } = useTranslation();
  return (
    <svg
      role="img"
      aria-label={t(`help.november_release.sketch.${name}`)}
      viewBox="0 0 520 248"
      className="block h-auto w-full rounded-xl border border-black/10 bg-[#fffdf6]"
      fill="none"
      stroke={ink}
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fontFamily={handwriting}
      fontSize="20"
      textAnchor="middle"
    >
      <defs>
        <pattern
          id={`dots-${name}`}
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="3" r=".85" fill="#c9c6b8" stroke="none" />
        </pattern>
      </defs>
      <rect
        width="520"
        height="248"
        fill={`url(#dots-${name})`}
        stroke="none"
      />
      {children}
    </svg>
  );
}

function Label({ x, y, children, size = 20 }) {
  return (
    <text x={x} y={y} fontSize={size} stroke="none" fill={ink}>
      {children}
    </text>
  );
}

export function DeploymentSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper name="deployment">
      <path
        d="M18 34 Q16 21 34 22 L482 18 Q501 17 501 34 L503 161 Q504 175 489 176 L34 178 Q18 178 19 165Z"
        fill="#e1f3df"
        stroke="#558665"
      />
      <path d="M27 31 Q175 26 286 27" stroke="#92bb9b" strokeWidth="1.3" />
      <Label x="80" y="49" size={19}>
        {t("green")}
      </Label>
      <g transform="translate(-22 8) rotate(-3 86 100)">
        <path d="M54 67 L120 66 L119 104 L55 105Z" fill="#fffefa" />
        <path d="M54 105 L45 113 Q79 116 129 112 L120 104Z" fill="#b8d4d6" />
        <path
          d="M61 73 L113 72 L112 97 L61 98Z"
          stroke="#60888c"
          strokeWidth="1.4"
        />
      </g>
      <path
        d="M110 100 Q188 94 267 98 M256 91 L268 98 L256 105"
        stroke="#477c61"
      />
      <Label x="191" y="67" size={16}>
        aicore.tool.huawei.com
      </Label>
      <g transform="translate(62 8) rotate(2 252 88)">
        <path
          d="M216 65 Q250 62 286 65 L286 86 L216 87Z M216 90 L285 89 L285 109 L217 110Z"
          fill="#b4dec0"
        />
        <path d="M226 75 L247 75 M227 100 L246 99" />
        <circle cx="275" cy="75" r="2" fill={ink} />
        <circle cx="275" cy="99" r="2" fill={ink} />
      </g>
      <path
        d="M355 99 Q376 95 397 99 M387 93 L398 99 L387 106"
        stroke="#477c61"
      />
      <g transform="translate(32 8) rotate(-3 421 88)">
        <path
          d="M388 75 L416 61 L447 74 L420 90Z M388 75 L388 95 L420 109 L420 90 M420 109 L447 94 L447 74"
          fill="#f9dc90"
        />
        <path
          d="M397 85 L413 92 M397 90 L413 97"
          stroke="#be924e"
          strokeWidth="1.3"
        />
      </g>
      <Label x="65" y="147">
        {t("laptop")}
      </Label>
      <Label x="313" y="143">
        CoreGenie
      </Label>
      <Label x="313" y="165" size={16}>
        {t("server")}
      </Label>
      <Label x="451" y="147" size={18}>
        {t("models")}
      </Label>
      <g transform="translate(0 6) rotate(-1 131 205)">
        <path
          d="M20 178 L243 177 L242 232 L21 234Z"
          fill="#fff0bb"
          stroke="#ae8643"
        />
        <Label x="131" y="201" size={18}>
          {t("yellow")}
        </Label>
        <Label x="131" y="222" size={16}>
          {t("blocked")}
        </Label>
      </g>
      <g transform="translate(0 6) rotate(1 384 205)">
        <path
          d="M262 179 L500 176 L499 232 L263 233Z"
          fill="#dcebf9"
          stroke="#698ba7"
        />
        <Label x="381" y="201" size={18}>
          {t("blue")}
        </Label>
        <Label x="381" y="222" size={16}>
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
    <Paper name="signin">
      <g transform="rotate(-3 96 120)">
        <path
          d="M28 80 Q28 73 38 73 L154 73 Q162 73 163 81 L162 157 L29 159Z"
          fill="#deedf5"
        />
        <path d="M30 95 L161 93 M37 81 L41 81 M48 81 L52 81" />
        <Label x="95" y="133">
          CoreGenie
        </Label>
      </g>
      <g transform="rotate(3 421 116)">
        <path
          d="M365 71 L470 69 Q478 69 478 77 L478 155 L362 157 L363 81Z"
          fill="#fffdf7"
        />
        <path d="M405 60 L435 60 L435 76 L405 77Z" fill="#fffcf6" />
        <image href={huaweiLogo} x="371" y="88" width="98" height="25" />
        <Label x="420" y="140" size={18}>
          IDaaS
        </Label>
      </g>
      <path
        d="M159 69 Q241 8 356 66 M347 53 L357 66 L341 65"
        stroke="#407696"
        strokeWidth="2.8"
      />
      <Label x="256" y="76" size={18}>
        {t("redirect")}
      </Label>
      <Label x="96" y="184" size={19}>
        {t("start")}
      </Label>
      <Label x="419" y="184" size={19}>
        {t("authenticate")}
      </Label>
      <path
        d="M363 192 Q265 246 155 193 M164 205 L154 193 L170 193"
        stroke="#4f865f"
        strokeWidth="2.8"
      />
      <Label x="258" y="184" size={18}>
        {t("return")}
      </Label>
    </Paper>
  );
}

export function IdeasSketch() {
  const { t } = useTranslation("common", {
    keyPrefix: "help.november_release.sketch",
  });
  return (
    <Paper name="ideas">
      <path
        d="M61 183 Q78 212 145 201 T256 201 Q311 223 369 195"
        stroke="#959684"
        strokeDasharray="4 8"
      />
      <g transform="rotate(-7 103 112)">
        <path d="M38 59 L176 56 L174 171 L39 173Z" fill="#fce4a5" />
        <path
          d="M79 48 L126 48 L124 66 L77 65Z"
          fill="#edd9af"
          stroke="#ae9970"
          strokeWidth="1.2"
        />
        <path
          d="M83 83 L117 82 L118 115 L84 116Z M78 89 L78 121 L110 122 M90 91 L109 91 M90 99 L106 99"
          fill="#fff6d6"
        />
        <Label x="107" y="151">
          {t("find")}
        </Label>
      </g>
      <g transform="rotate(3 260 120)">
        <path d="M193 73 L326 70 L327 183 L194 184Z" fill="#d8ecdd" />
        <path
          d="M237 61 L282 62 L283 79 L236 78Z"
          fill="#e5d8b6"
          stroke="#ae9970"
          strokeWidth="1.2"
        />
        <path d="M230 100 L242 99 L242 111 L230 112Z M251 106 L283 105 M230 119 L242 118 L242 130 L230 130Z M251 125 L280 124" />
        <path d="M230 102 L235 108 L245 96" stroke="#458368" />
        <Label x="260" y="163">
          {t("check")}
        </Label>
      </g>
      <g transform="rotate(-4 420 104)">
        <path d="M355 49 L486 50 L488 160 L356 162Z" fill="#e9dff5" />
        <path
          d="M392 40 L440 39 L441 56 L391 57Z"
          fill="#e5d8b6"
          stroke="#ae9970"
          strokeWidth="1.2"
        />
        <path
          d="M399 93 L425 69 L433 77 L407 101 L395 105Z M421 73 L429 81 M398 95 L404 102"
          fill="#fff5c9"
        />
        <path d="M410 106 Q424 101 440 105" stroke="#967ca6" />
        <Label x="421" y="137">
          {t("yourIdea")}
        </Label>
      </g>
    </Paper>
  );
}

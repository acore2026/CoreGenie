import { useTheme } from "@/hooks/useTheme";

export function OnboardingLogoSVG() {
  const { isLight } = useTheme();
  const stroke = isLight ? "#64748B" : "#CBD5E1";

  return (
    <svg
      viewBox="0 0 818 514"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-hidden="true"
    >
      <circle
        cx="409"
        cy="257"
        r="190"
        stroke={stroke}
        strokeWidth="76"
        strokeLinecap="round"
        strokeDasharray="895 300"
        transform="rotate(44 409 257)"
        opacity={isLight ? 0.18 : 0.16}
      />
      <path
        d="M409 257H612"
        stroke={stroke}
        strokeWidth="76"
        strokeLinecap="round"
        opacity={isLight ? 0.18 : 0.16}
      />
      <circle
        cx="409"
        cy="257"
        r="58"
        fill="#38BDF8"
        opacity={isLight ? 0.28 : 0.24}
      />
      <circle
        cx="629"
        cy="257"
        r="31"
        fill="#38BDF8"
        opacity={isLight ? 0.28 : 0.24}
      />
    </svg>
  );
}

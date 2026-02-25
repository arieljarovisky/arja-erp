import { useId } from "react";
import { useTheme } from "../context/ThemeContext";

const VARIANTS = {
  light: {
    iconBackground: "#FFFFFF",
    iconShadow: "0 16px 32px rgba(9, 64, 118, 0.18)",
    iconBorder: "1px solid rgba(19, 181, 207, 0.16)",
    svgRectFill: "#FFFFFF",
    primaryText: "#083B5D",
    accent: "#13B5CF",
    tagline: "#1C8FA6",
    arrowFill: "#F8FEFF",
    highlightGradient: ["#F6FDFF", "#B9F4FF"],
    gearGradient: ["#0A4F72", "#08375D"],
  },
  dark: {
    iconBackground: "rgba(7, 23, 36, 0.96)",
    iconShadow: "0 22px 40px rgba(5, 73, 104, 0.36)",
    iconBorder: "1px solid rgba(79, 212, 228, 0.28)",
    svgRectFill: "#0A1F33",
    primaryText: "#F1FAFF",
    accent: "#4FD4E4",
    tagline: "#8CD9E9",
    arrowFill: "#F8FEFF",
    highlightGradient: ["#12324B", "#1F5F79"],
    gearGradient: ["#46C5E6", "#1480C4"],
  },
};

function detectSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Logo({ size = "default", showText = true, className = "", variant = "auto" }) {
  const sizes = {
    small: "w-9 h-9",
    default: "w-11 h-11 sm:w-14 sm:h-14",
    large: "w-18 h-18",
    xl: "w-24 h-24",
  };

  const textSizes = {
    small: "text-sm",
    default: "text-base sm:text-xl",
    large: "text-2xl sm:text-3xl",
    xl: "text-3xl sm:text-4xl",
  };

  let themeContext;
  try {
    themeContext = useTheme();
  } catch {
    themeContext = { theme: "light" };
  }

  const contextTheme = themeContext?.theme ?? "light";
  const effectiveVariant = variant === "auto" ? contextTheme : variant;
  const normalizedVariant =
    effectiveVariant === "system" ? detectSystemTheme() : effectiveVariant;
  const palette = VARIANTS[normalizedVariant] ?? VARIANTS.light;

  const id = typeof useId === "function" ? useId() : "arja-logo";
  const gradLeftId = `${id}-left`;
  const gradRightId = `${id}-right`;
  const gradHighlightId = `${id}-highlight`;
  const gradGearId = `${id}-gear`;

  const iconWrapperStyle = {
    background: palette.iconBackground,
    boxShadow: palette.iconShadow,
    border: palette.iconBorder,
  };

  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${className}`}>
      <div className={`${sizes[size]} relative flex-shrink-0`}>
        <div
          className="w-full h-full rounded-2xl flex items-center justify-center"
          style={iconWrapperStyle}
        >
          <svg viewBox="0 0 220 220" className="w-4/5 h-4/5" role="img" aria-label="ARJA ERP" focusable="false">
            <defs>
              <linearGradient id={gradLeftId} x1="15%" y1="90%" x2="65%" y2="10%">
                <stop offset="0%" stopColor="#4FD4E4" />
                <stop offset="100%" stopColor="#13B5CF" />
              </linearGradient>
              <linearGradient id={gradRightId} x1="30%" y1="0%" x2="95%" y2="90%">
                <stop offset="0%" stopColor="#1AC3DF" />
                <stop offset="100%" stopColor="#0D7FD4" />
              </linearGradient>
              <linearGradient id={gradHighlightId} x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor={palette.highlightGradient[0]} />
                <stop offset="100%" stopColor={palette.highlightGradient[1]} />
              </linearGradient>
              <linearGradient id={gradGearId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={palette.gearGradient[0]} />
                <stop offset="100%" stopColor={palette.gearGradient[1]} />
              </linearGradient>
            </defs>

            <rect x="10" y="10" width="200" height="200" rx="48" fill={palette.svgRectFill} />

            <path d="M111 20L40 200h44l39-104 39 104h44L135 20z" fill={`url(#${gradLeftId})`} />

            <path d="M111 20L135 20 204 200h-42l-28-72-23-64z" fill={`url(#${gradRightId})`} />

            <path d="M111 76l18 48h-56z" fill={`url(#${gradHighlightId})`} opacity="0.7" />

            <path
              d="M68 104h66l-15-15 11-11 34 34-34 34-11-11 15-15H68c-8.3 0-15 6.7-15 15 0 6.7 4.2 12.4 10.4 14.5l-12.6 12.6C41.7 147.6 36 135.2 36 121c0-23.2 18.8-42 42-42Z"
              fill={palette.arrowFill}
              stroke={palette.accent}
              strokeWidth="6"
              strokeLinejoin="round"
            />

            <g transform="translate(148 116) scale(3.2)">
              <path
                d="M11.983 1.5a1.5 1.5 0 0 0-1.415.987l-.55 1.51a8.06 8.06 0 0 0-1.695.98l-1.518-.551a1.5 1.5 0 0 0-1.898.832l-1.5 3.897a1.5 1.5 0 0 0 .832 1.898l1.519.55a8.06 8.06 0 0 0 0 1.963l-1.52.55a1.5 1.5 0 0 0-.831 1.898l1.5 3.897a1.5 1.5 0 0 0 1.898.832l1.518-.55a8.06 8.06 0 0 0 1.695.98l.55 1.509a1.5 1.5 0 0 0 1.898.832l3.897-1.5a1.5 1.5 0 0 0 .832-1.898l-.55-1.519a8.06 8.06 0 0 0 .98-1.695l1.509-.55a1.5 1.5 0 0 0 .832-1.898l-1.5-3.897a1.5 1.5 0 0 0-1.898-.831l-1.519.55a8.06 8.06 0 0 0-1.695-.98l-.55-1.51A1.5 1.5 0 0 0 11.983 1.5Zm.017 6a3 3 0 1 1-3 3 3 3 0 0 1 3-3Z"
                fill={`url(#${gradGearId})`}
              />
            </g>
          </svg>
        </div>
      </div>

      {showText && (
        <div className="min-w-0 flex-1">
          <div className={`flex flex-wrap items-baseline gap-1 leading-tight ${textSizes[size]}`}>
            <h1 className="font-semibold tracking-tight" style={{ color: palette.primaryText }}>
              ARJA
            </h1>
            <span
              className={`${size === "small" ? "text-xs leading-none" : "text-sm sm:text-base"} font-semibold`}
              style={{ color: palette.accent }}
            >
              ERP
            </span>
          </div>
          {size !== "small" && (
            <p
              className="text-[10px] sm:text-xs leading-tight mt-[2px] uppercase tracking-[0.12em]"
              style={{ color: palette.tagline }}
            >
              Gestión Empresarial Inteligente
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Skeleton({ className = "", ariaLabel = "Cargando…" }) {
  return (
    <div
      className={`animate-pulse bg-gray-200/70 rounded-lg ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={ariaLabel}
    />
  );
}

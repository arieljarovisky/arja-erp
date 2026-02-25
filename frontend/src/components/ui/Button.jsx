import clsx from "clsx";

export default function Button({ className, children, variant = "primary", ...props }) {
  const variants = {
    primary: "arja-btn--primary",
    secondary: "arja-btn--secondary",
    danger: "arja-btn--danger",
    ghost: "arja-btn--ghost",
    success: "arja-btn--success",
  };

  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={clsx("arja-btn", variants[variant] || variants.primary, className)}
    >
      {children}
    </button>
  );
}



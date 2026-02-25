function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function recommendPlanForSession(session = {}) {
  const business = session.business || {};
  const features = session.features || {};

  const professionals = toNumber(
    business.professionals_count ??
      business.staff_count ??
      business.employees ??
      business.professionals,
    0
  );

  const monthlyAppointments = toNumber(
    business.monthly_appointments ??
      business.turnos_mensuales ??
      business.bookings_per_month,
    0
  );

  const needsInvoicing =
    Boolean(features.facturacion) ||
    Boolean(features.billing) ||
    Boolean(business.needs_invoicing);

  const needsStock = Boolean(features.stock) || Boolean(business.needs_stock);
  const needsClasses =
    Boolean(features.classes) || Boolean(business.needs_classes);
  const needsAutomation =
    Boolean(features.automation) || Boolean(features.reminders);

  let recommended = "starter";
  const reasons = [];

  if (needsInvoicing || needsStock || needsClasses || professionals > 5) {
    recommended = "growth";
    reasons.push(
      needsInvoicing
        ? "Necesita facturación electrónica"
        : needsStock
        ? "Gestiona stock de productos"
        : needsClasses
        ? "Ofrece clases o sesiones grupales"
        : "Tiene más de 5 profesionales"
    );
  }

  if (
    professionals > 10 ||
    monthlyAppointments > 400 ||
    (needsInvoicing && needsAutomation)
  ) {
    recommended = "pro";
    reasons.push(
      professionals > 10
        ? "Más de 10 profesionales"
        : monthlyAppointments > 400
        ? "Gran volumen de turnos mensuales"
        : "Necesita automatizaciones avanzadas y facturación"
    );
  }

  if (reasons.length === 0) {
    reasons.push("Comienza con funciones básicas y crecimiento gradual");
  }

  const plans = ["starter", "growth", "pro"];
  const alternatives = plans.filter((plan) => plan !== recommended);

  return {
    recommended,
    alternatives,
    reasons,
    input: {
      professionals,
      monthlyAppointments,
      needsInvoicing,
      needsStock,
      needsClasses,
      needsAutomation,
    },
  };
}

export default {
  recommendPlanForSession,
};


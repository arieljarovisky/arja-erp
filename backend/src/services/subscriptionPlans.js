const PLAN_FEATURE_FLAGS = {
  starter: {
    appointments: true,
    stock: false,
    invoicing: false,
    classes: true,
    multiBranch: false,
    maxBranches: 1,
    mobile_app: false,
  },
  growth: {
    appointments: true,
    stock: true,
    invoicing: false,
    classes: true,
    multiBranch: false,
    maxBranches: 1,
    mobile_app: false,
  },
  scale: {
    appointments: true,
    stock: true,
    invoicing: true,
    classes: true,
    multiBranch: true,
    maxBranches: 2,
    mobile_app: false,
  },
  pro: {
    appointments: true,
    stock: true,
    invoicing: true,
    classes: true,
    multiBranch: true,
    maxBranches: null, // ilimitado
    mobile_app: true,
  },
};

const PLANS = {
  starter: {
    code: "starter",
    label: "Plan Starter",
    description: "Ideal para comenzar con hasta 2 profesionales",
    amount: 15,
    currency: "ARS",
    features: PLAN_FEATURE_FLAGS.starter,
  },
  growth: {
    code: "growth",
    label: "Plan Growth",
    description: "Negocios en expansión, hasta 8 profesionales",
    amount: 16,
    currency: "ARS",
    features: PLAN_FEATURE_FLAGS.growth,
  },
  scale: {
    code: "scale",
    label: "Plan Escala",
    description: "Operaciones con varias sucursales (hasta 2 sedes)",
    amount: 17,
    currency: "ARS",
    features: PLAN_FEATURE_FLAGS.scale,
  },
  pro: {
    code: "pro",
    label: "Plan Pro a Medida",
    description: "Empresas grandes con múltiples sucursales ilimitadas",
    amount: 17,
    currency: "ARS",
    features: PLAN_FEATURE_FLAGS.pro,
  },
};

export function getPlanDefinition(planCode) {
  if (!planCode) return PLANS.starter;
  const normalized = String(planCode).toLowerCase();
  return PLANS[normalized] || PLANS.starter;
}

export function getPlanFeatureFlags(planCode) {
  const plan = getPlanDefinition(planCode);
  return plan?.features || PLAN_FEATURE_FLAGS.starter;
}

export function listPlans() {
  return Object.values(PLANS);
}

export default {
  getPlanDefinition,
  getPlanFeatureFlags,
  listPlans,
};


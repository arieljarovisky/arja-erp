import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Calendar, 
  Users, 
  DollarSign, 
  Bell, 
  Smartphone, 
  Shield, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  Menu,
  X,
  MessageSquare,
  FileSpreadsheet,
  Building2,
  UserPlus
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../i18n/useTranslation.js";
import { useAuth } from "../context/AuthContext.jsx";
import { authApi, getAccessToken } from "../api/client";
import { logger } from "../utils/logger.js";
import ThemeToggle from "../components/ThemeToggle";
import LanguageSelector from "../components/LanguageSelector";
import Logo from "../components/Logo";
import ChatWidget from "../components/ChatWidget";

export default function LandingPage() {
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user, authLoaded } = useAuth();

  // Cambiar el título de la página
  useEffect(() => {
    document.title = t("landing.title");
  }, [t]);

  useEffect(() => {
    if (authLoaded && user) {
      const isSuperAdmin = user?.isSuperAdmin || user?.is_super_admin;
      const slug = user?.tenant?.slug || null;
      const dest = isSuperAdmin ? "/super-admin/tenants" : slug ? `/${slug}/dashboard` : "/dashboard";
      navigate(dest, { replace: true });
      return;
    }
    const run = async () => {
      try {
        const token = getAccessToken();
        if (token) {
          const me = await authApi.me();
          if (me?.ok && me?.user) {
            const isSuperAdmin = me.user.isSuperAdmin || me.user.is_super_admin;
            const slug = me.tenant?.slug || null;
            const dest = isSuperAdmin ? "/super-admin/tenants" : slug ? `/${slug}/dashboard` : "/dashboard";
            navigate(dest, { replace: true });
            return;
          }
        } else {
          const refreshed = await authApi.refresh();
          if (refreshed) {
            const me2 = await authApi.me();
            if (me2?.ok && me2?.user) {
              const isSuperAdmin = me2.user.isSuperAdmin || me2.user.is_super_admin;
              const slug = me2.tenant?.slug || null;
              const dest = isSuperAdmin ? "/super-admin/tenants" : slug ? `/${slug}/dashboard` : "/dashboard";
              navigate(dest, { replace: true });
              return;
            }
          }
        }
      } catch (e) {
        logger.warn("[Landing] auto-redirect error:", e);
      }
    };
    run();
  }, [authLoaded, user, navigate]);

  const features = [
    {
      icon: Calendar,
      title: t("landing.features.appointments.title"),
      description: t("landing.features.appointments.description")
    },
    {
      icon: Users,
      title: t("landing.features.customers.title"),
      description: t("landing.features.customers.description")
    },
    {
      icon: DollarSign,
      title: t("landing.features.payments.title"),
      description: t("landing.features.payments.description")
    },
    {
      icon: Bell,
      title: t("landing.features.notifications.title"),
      description: t("landing.features.notifications.description")
    },
    {
      icon: Smartphone,
      title: t("landing.features.whatsapp.title"),
      description: t("landing.features.whatsapp.description")
    },
    {
      icon: Shield,
      title: t("landing.features.security.title"),
      description: t("landing.features.security.description")
    }
  ];

  const pricingPlans = [
    {
      name: t("landing.pricing.plans.essential.name"),
      price: "$14.900",
      period: "mes",
      description: t("landing.pricing.plans.essential.description"),
      features: [
        t("landing.pricing.plans.essential.features.professionals"),
        t("landing.pricing.plans.essential.features.appointments"),
        t("landing.pricing.plans.essential.features.reminders"),
        t("landing.pricing.plans.essential.features.customers"),
        t("landing.pricing.plans.essential.features.reports")
      ],
      popular: false
    },
    {
      name: t("landing.pricing.plans.growth.name"),
      price: "$24.900",
      period: "mes",
      description: t("landing.pricing.plans.growth.description"),
      features: [
        t("landing.pricing.plans.growth.features.professionals"),
        t("landing.pricing.plans.growth.features.payments"),
        t("landing.pricing.plans.growth.features.whatsapp"),
        t("landing.pricing.plans.growth.features.stock"),
        t("landing.pricing.plans.growth.features.dashboards"),
        t("landing.pricing.plans.growth.features.support")
      ],
      popular: true
    },
    {
      name: t("landing.pricing.plans.scale.name"),
      price: "$44.900",
      period: "mes",
      description: t("landing.pricing.plans.scale.description"),
      features: [
        t("landing.pricing.plans.scale.features.professionals"),
        t("landing.pricing.plans.scale.features.branches"),
        t("landing.pricing.plans.scale.features.multibranch"),
        t("landing.pricing.plans.scale.features.automation"),
        t("landing.pricing.plans.scale.features.afip"),
        t("landing.pricing.plans.scale.features.dashboards"),
        t("landing.pricing.plans.scale.features.whatsapp"),
        t("landing.pricing.plans.scale.features.onboarding")
      ],
      popular: false
    },
    {
      name: t("landing.pricing.plans.enterprise.name"),
      price: "Consultar",
      period: "",
      description: t("landing.pricing.plans.enterprise.description"),
      features: [
        t("landing.pricing.plans.enterprise.features.architecture"),
        t("landing.pricing.plans.enterprise.features.branches"),
        t("landing.pricing.plans.enterprise.features.api"),
        t("landing.pricing.plans.enterprise.features.integrations"),
        t("landing.pricing.plans.enterprise.features.training"),
        t("landing.pricing.plans.enterprise.features.sla"),
        t("landing.pricing.plans.enterprise.features.launch")
      ],
      popular: false
    }
  ];

  const stats = [
    {
      value: t("landing.stats.automation.value"),
      label: t("landing.stats.automation.label"),
      description: t("landing.stats.automation.description")
    },
    {
      value: t("landing.stats.availability.value"),
      label: t("landing.stats.availability.label"),
      description: t("landing.stats.availability.description")
    },
    {
      value: t("landing.stats.uptime.value"),
      label: t("landing.stats.uptime.label"),
      description: t("landing.stats.uptime.description")
    },
    {
      value: t("landing.stats.features.value"),
      label: t("landing.stats.features.label"),
      description: t("landing.stats.features.description")
    }
  ];

  const useCases = [
    {
      icon: Calendar,
      title: t("landing.useCases.appointments.title"),
      description: t("landing.useCases.appointments.description")
    },
    {
      icon: Users,
      title: t("landing.useCases.teams.title"),
      description: t("landing.useCases.teams.description")
    },
    {
      icon: DollarSign,
      title: t("landing.useCases.payments.title"),
      description: t("landing.useCases.payments.description")
    },
    {
      icon: Bell,
      title: t("landing.useCases.automation.title"),
      description: t("landing.useCases.automation.description")
    },
    {
      icon: FileSpreadsheet,
      title: t("landing.useCases.invoicing.title"),
      description: t("landing.useCases.invoicing.description")
    },
    {
      icon: Building2,
      title: t("landing.useCases.branches.title"),
      description: t("landing.useCases.branches.description")
    },
    {
      icon: Zap,
      title: t("landing.useCases.fast.title"),
      description: t("landing.useCases.fast.description")
    },
    {
      icon: Shield,
      title: t("landing.useCases.regulated.title"),
      description: t("landing.useCases.regulated.description")
    }
  ];

  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5 }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="landing-nav">
        <div className="landing-nav__container">
          <div className="landing-nav__brand">
            <Logo size="default" showText={true} />
          </div>

          <div className="landing-nav__links">
            <a
              href="#features"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="landing-nav__link"
            >
              {t("landing.nav.features")}
            </a>
            <a
              href="#pricing"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="landing-nav__link"
            >
              {t("landing.nav.pricing")}
            </a>
            <a
              href="#use-cases"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("use-cases")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="landing-nav__link"
            >
              {t("landing.nav.useCases")}
            </a>
            <a
              href="/docs"
              onClick={(e) => {
                e.preventDefault();
                navigate("/docs");
              }}
              className="landing-nav__link"
            >
              {t("landing.nav.docs")}
            </a>
            <div className="landing-nav__auth">
              <LanguageSelector />
              <ThemeToggle />
              <button
                onClick={() => navigate("/login")}
                className="btn-ghost btn--compact"
              >
                {t("landing.auth.login")}
              </button>
              <button
                onClick={() => navigate("/onboarding")}
                className="btn-primary btn--compact"
              >
                {t("landing.auth.startFree")}
              </button>
            </div>
          </div>

          <button
            className="landing-nav__toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="landing-nav__mobile">
            <a
              href="#features"
              onClick={() => {
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
                setMobileMenuOpen(false);
              }}
            >
              {t("landing.nav.features")}
            </a>
            <a
              href="#pricing"
              onClick={() => {
                document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
                setMobileMenuOpen(false);
              }}
            >
              {t("landing.nav.pricing")}
            </a>
            <a
              href="#use-cases"
              onClick={() => {
                document.getElementById("use-cases")?.scrollIntoView({ behavior: "smooth" });
                setMobileMenuOpen(false);
              }}
            >
              {t("landing.nav.useCases")}
            </a>
            <a
              href="/docs"
              onClick={(e) => {
                e.preventDefault();
                setMobileMenuOpen(false);
                navigate("/docs");
              }}
            >
              {t("landing.nav.docs")}
            </a>
            <div className="landing-nav__mobile-theme">
              <LanguageSelector />
              <ThemeToggle />
            </div>
            <button
              onClick={() => {
                navigate("/login");
                setMobileMenuOpen(false);
              }}
              className="btn-ghost w-full"
            >
              {t("landing.auth.login")}
            </button>
            <button
              onClick={() => {
                navigate("/onboarding");
                setMobileMenuOpen(false);
              }}
              className="btn-primary w-full"
            >
              {t("landing.auth.startFree")}
            </button>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-24 pb-16 px-4 sm:pt-32 sm:pb-20 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="initial"
            animate="animate"
            variants={{
              initial: { opacity: 0 },
              animate: { opacity: 1, transition: { staggerChildren: 0.2 } }
            }}
            className="text-center"
          >
            <motion.h1
              variants={fadeInUp}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-foreground mb-4 sm:mb-6"
            >
              {t("landing.hero.title")}
              <br />
              <span className="text-gradient">
                {t("landing.hero.titleHighlight")}
              </span>
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-base sm:text-lg md:text-xl lg:text-2xl text-foreground-secondary mb-6 sm:mb-8 max-w-3xl mx-auto px-4"
            >
              {t("landing.hero.subtitle")}
            </motion.p>
            <motion.div
              variants={fadeInUp}
              className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center px-4"
            >
              <button
                onClick={() => navigate("/onboarding")}
                className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-primary text-white rounded-lg font-semibold hover:bg-primary-hover transition-all flex items-center justify-center gap-2 shadow-lg text-sm sm:text-base"
              >
                {t("landing.hero.ctaPrimary")}
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                onClick={() => {
                  document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-background-secondary text-foreground rounded-lg font-semibold hover:bg-border transition-colors border border-border text-sm sm:text-base"
              >
                {t("landing.hero.ctaSecondary")}
              </button>
            </motion.div>
            <motion.p
              variants={fadeInUp}
              className="text-xs sm:text-sm text-foreground-muted mt-4 sm:mt-6 px-4"
            >
              {t("landing.hero.trial")}
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8 sm:mb-12 lg:mb-16"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-3 sm:mb-4 px-4">
              {t("landing.features.title")}
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-foreground-secondary max-w-2xl mx-auto px-4">
              {t("landing.features.subtitle")}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="card card--space-lg"
                >
                  <div className="w-12 h-12 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-foreground-secondary">
                    {feature.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-background-secondary">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8 sm:mb-12 lg:mb-16"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-3 sm:mb-4 px-4">
              {t("landing.pricing.title")}
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-foreground-secondary max-w-2xl mx-auto px-4">
              {t("landing.pricing.subtitle")}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {pricingPlans.map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`card p-6 sm:p-8 relative ${
                  plan.popular
                    ? "ring-2 ring-primary sm:scale-105"
                    : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-primary text-white px-4 py-1 rounded-full text-sm font-semibold">
                      {t("landing.pricing.mostPopular")}
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-foreground mb-2">{plan.name}</h3>
                  <p className="text-foreground-secondary text-sm mb-4">{plan.description}</p>
                  <div className="flex items-baseline">
                    <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                    {plan.period && (
                      <span className="text-foreground-secondary ml-2">/{plan.period}</span>
                    )}
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle2 className="w-5 h-5 text-primary mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-foreground-secondary">{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    if (plan.name === "Pro a medida") {
                      navigate("/enterprise-request");
                    } else {
                      navigate("/onboarding");
                    }
                  }}
                  className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                    plan.popular
                      ? "bg-primary text-white hover:bg-primary-hover"
                      : "bg-background-secondary text-foreground hover:bg-border border border-border"
                  }`}
                >
                  {t("landing.pricing.startNow")}
                </button>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center text-foreground-secondary mt-8"
          >
            {t("landing.pricing.trialNote")}
          </motion.p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-background-secondary">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8 sm:mb-12 lg:mb-16"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-3 sm:mb-4 px-4">
              {t("landing.stats.title")}
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-foreground-secondary max-w-2xl mx-auto px-4">
              {t("landing.stats.subtitle")}
            </p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {stats.map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="text-center px-2"
              >
                <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-primary mb-1 sm:mb-2">
                  {stat.value}
                </div>
                <div className="text-base sm:text-lg lg:text-xl font-semibold text-foreground mb-1">
                  {stat.label}
                </div>
                <div className="text-xs sm:text-sm text-foreground-secondary">
                  {stat.description}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="use-cases" className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8 sm:mb-12 lg:mb-16"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-3 sm:mb-4 px-4">
              {t("landing.useCases.title")}
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-foreground-secondary max-w-2xl mx-auto px-4">
              {t("landing.useCases.subtitle")}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {useCases.map((useCase, index) => {
              const Icon = useCase.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="card card--space-lg"
                >
                  <div className="w-12 h-12 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    {useCase.title}
                  </h3>
                  <p className="text-foreground-secondary">
                    {useCase.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="card card--space-lg sm:card--space-xl card--no-hover text-center"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-3 sm:mb-4 px-4">
              {t("landing.cta.title")}
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-foreground-secondary mb-6 sm:mb-8 max-w-2xl mx-auto px-4">
              {t("landing.cta.subtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4">
              <button
                onClick={() => navigate("/login")}
                className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-primary text-white rounded-lg font-semibold hover:bg-primary-hover transition-all flex items-center justify-center gap-2 shadow-lg text-sm sm:text-base"
              >
                {t("landing.cta.startFree")}
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                onClick={() => {
                  document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-background-secondary text-foreground rounded-lg font-semibold hover:bg-border transition-colors border border-border text-sm sm:text-base"
              >
                {t("landing.cta.viewPlans")}
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 sm:py-12 px-4 sm:px-6 lg:px-8 bg-background-secondary">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 mb-6 sm:mb-8">
            <div>
              <div className="mb-4">
                <Logo size="default" showText={true} />
              </div>
              <p className="text-foreground-secondary text-sm">
                {t("landing.footer.description")}
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4">{t("landing.footer.product")}</h4>
              <ul className="space-y-2 text-sm text-foreground-secondary">
                <li><a href="#features" className="hover:text-foreground transition-colors">{t("landing.footer.features")}</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">{t("landing.footer.pricing")}</a></li>
                <li><a href="#use-cases" className="hover:text-foreground transition-colors">{t("landing.footer.useCases")}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4">{t("landing.footer.support")}</h4>
              <ul className="space-y-2 text-sm text-foreground-secondary">
                <li><a href="/docs" onClick={(e) => { e.preventDefault(); navigate("/docs"); }} className="hover:text-foreground transition-colors">{t("landing.footer.docs")}</a></li>
                <li><a href="/help" onClick={(e) => { e.preventDefault(); navigate("/help"); }} className="hover:text-foreground transition-colors">{t("landing.footer.help")}</a></li>
                <li><a href="/contact" onClick={(e) => { e.preventDefault(); navigate("/contact"); }} className="hover:text-foreground transition-colors">{t("landing.footer.contact")}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4">{t("landing.footer.legal")}</h4>
              <ul className="space-y-2 text-sm text-foreground-secondary">
                <li><a href="/terms" onClick={(e) => { e.preventDefault(); navigate("/terms"); }} className="hover:text-foreground transition-colors">{t("landing.footer.terms")}</a></li>
                <li><a href="/privacy.html" className="hover:text-foreground transition-colors">{t("landing.footer.privacy")}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 text-center text-sm text-foreground-secondary">
            <p>&copy; {new Date().getFullYear()} ARJA ERP. {t("landing.footer.copyright")}</p>
          </div>
        </div>
      </footer>

      {/* Chat Widget */}
      <ChatWidget />
    </div>
  );
}

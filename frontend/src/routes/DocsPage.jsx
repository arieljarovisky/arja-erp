import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpenCheck,
  Calendar,
  Users,
  DollarSign,
  Bell,
  Smartphone,
  Shield,
  BarChart2,
  Layers,
  Boxes,
  Globe,
  Settings,
} from "lucide-react";

const iconMap = {
  calendar: Calendar,
  users: Users,
  payments: DollarSign,
  notifications: Bell,
  whatsapp: Smartphone,
  security: Shield,
  reports: BarChart2,
  layers: Layers,
  stock: Boxes,
  integrations: Globe,
  settings: Settings,
};

const tutorialSteps = [
  {
    title: "1. Crear tu cuenta y completar el onboarding",
    description:
      "Iniciá en arjaerp.com.ar → Comenzar Gratis. El asistente te guía para definir negocio, horarios y primeros servicios.",
    tips: ["Podés importar clientes desde Excel más tarde.", "Si ya tenés token de Mercado Pago, conectalo en este paso."],
  },
  {
    title: "2. Configurar negocio, WhatsApp y Mercado Pago",
    description:
      "Dentro del panel (Config → Reservas/WhatsApp) cargá datos fiscales, ARCA, número de WhatsApp y credenciales de Mercado Pago.",
    tips: [
      "Seguimos el tutorial interno para delegaciones AFIP y certificados ARCA.",
      "El bot de WhatsApp queda operativo apenas verifiques el webhook.",
    ],
  },
  {
    title: "3. Cargar servicios, instructores y planes",
    description:
      "Desde Config → Servicios agregá duración y precio; en Instructores definí horarios y comisiones. En Membresías creás los planes con vencimientos.",
    tips: ["Podés duplicar servicios o importar desde planilla.", "Los planes se usan tanto en reservas como en el bot."],
  },
  {
    title: "4. Operar el día a día",
    description:
      "Usá el calendario para turnos, el módulo de clases para grupos, y clientes para ver pagos y estado de membresía. El bot y los recordatorios corren en automático.",
    tips: ["El dashboard muestra KPIs diarios y pendientes.", "Podés activar el blur de membresías para bloquear reservas vencidas."],
  },
  {
    title: "5. Cobrar y automatizar",
    description:
      "Generá links de seña desde cada turno o permití que el bot cree la suscripción con Mercado Pago. El webhook de MP actualiza el estado sin intervención manual.",
    tips: ["Las renovaciones se ven en Config → Reservas y en el detalle de cliente.", "Recibís alertas si hay pagos observados."],
  },
];

const sections = [
  {
    id: "agenda",
    title: "Agenda inteligente y reservas",
    description:
      "Gestioná turnos individuales, clases grupales y disponibilidad por profesional con el calendario centralizado.",
    icon: "calendar",
    bullets: [
      "Calendario drag & drop con vistas diaria, semanal y mensual.",
      "Buffer automático, recordatorios y bloqueo por membresía vencida.",
      "Repetición de sesiones, series de clases y cupos máximos.",
    ],
  },
  {
    id: "clientes",
    title: "Gestión completa de clientes",
    description:
      "Ficha unificada con historial, documentos, datos fiscales y métricas de asistencia.",
    icon: "users",
    bullets: [
      "Notas internas, documentos y campos fiscales para AFIP.",
      "Estado de membresía, pagos pendientes y próxima renovación.",
      "Embudo de reservas: próximos turnos, clases inscriptas y estadísticas.",
    ],
  },
  {
    id: "pagos",
    title: "Pagos y membresías automatizadas",
    description:
      "Integra Mercado Pago para señas, cuotas y membresías con links automáticos.",
    icon: "payments",
    bullets: [
      "Link de seña configurable (por porcentaje o monto fijo).",
      "Planes de membresía con vencimiento, días de gracia e interés.",
      "Suscripción vía WhatsApp: captura datos, envía link y activa al pagar.",
    ],
  },
  {
    id: "notificaciones",
    title: "Notificaciones automáticas",
    description:
      "Recordatorios y avisos 100% automatizados para reducir ausencias.",
    icon: "notifications",
    bullets: [
      "Recordatorios por WhatsApp y correo según tu configuración.",
      "Alertas internas cuando se vence una membresía o falta un pago.",
      "Flujos personalizables para confirmación, reprogramación y cancelación.",
    ],
  },
  {
    id: "whatsapp",
    title: "Bot conversacional en WhatsApp",
    description:
      "Tus clientes reservan, consultan planes o se suscriben sin salir del chat.",
    icon: "whatsapp",
    bullets: [
      "Menú dinámico con turnos, clases y membresías.",
      "Captura de datos (nombre, DNI, dirección, email) y sincronización con la base.",
      "Soporte multi‑tenant: cada sucursal tiene sus propios tokens y respuestas.",
    ],
  },
  {
    id: "operaciones",
    title: "Operaciones del día a día",
    description:
      "Controlá stock, comisiones y disponibilidad desde un solo lugar.",
    icon: "stock",
    bullets: [
      "Inventario y categorías con CRUD completo desde el panel.",
      "Módulo de comisiones por servicio o instructor.",
      "Dashboard de instructores con horarios, estadísticas y ganancias.",
    ],
  },
  {
    id: "integraciones",
    title: "Integraciones y facturación",
    description:
      "Conectá ARCA/AFIP, Mercado Pago y WhatsApp Business sin salir del sistema.",
    icon: "integrations",
    bullets: [
      "Tutorial guiado para configurar ARCA y delegaciones AFIP.",
      "Webhook propio para Mercado Pago y WhatsApp.",
      "API REST y webhooks listos para exponer datos a otras herramientas.",
    ],
  },
  {
    id: "seguridad",
    title: "Seguridad y configuración avanzada",
    description:
      "Roles, permisos y auditoría de cambios para escalar tu negocio con tranquilidad.",
    icon: "security",
    bullets: [
      "Roles por módulo (admin, staff, instructores, super admin).",
      "Backups automáticos y conexión cifrada a la base.",
      "Multi‑tenant: cada sucursal maneja sus propias credenciales y dominios.",
    ],
  },
];

export default function DocsPage() {
  const navigate = useNavigate();

  const toc = useMemo(() => {
    const base = [{ id: "tutorial", title: "Tutorial rápido" }];
    return [
      ...base,
      ...sections.map((section) => ({
        id: section.id,
        title: section.title,
      })),
    ];
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-background-secondary/70 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 text-sm text-foreground-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </button>
          <span className="text-sm text-foreground-muted">/</span>
          <div>
            <p className="text-xs uppercase tracking-wide text-primary-400 font-semibold">
              Documentación
            </p>
            <h1 className="text-xl font-semibold">Funcionalidades de ARJA ERP</h1>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        <section className="grid gap-6 lg:grid-cols-[1fr,300px]">
          <div className="card card--space-lg">
            <h2 className="text-3xl font-bold mb-4">
              Todo lo que incluye el sistema
            </h2>
            <p className="text-foreground-secondary leading-relaxed">
              ARJA ERP es una plataforma integral para estudios, gimnasios y peluquerías.
              Centraliza turnos, membresías, stock, facturación, notificaciones y el bot
              de WhatsApp en un solo panel. Este documento resume cada módulo para que
              puedas mostrar a tu equipo o a potenciales clientes qué cubrimos desde el día cero.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 text-sm text-primary">
              <BookOpenCheck className="w-4 h-4" />
              Actualizado {new Date().toLocaleDateString("es-AR")}
            </div>
          </div>

          <aside className="card card--space-lg sticky top-6 self-start">
            <p className="text-xs uppercase tracking-wide text-foreground-muted mb-3">
              Índice rápido
            </p>
            <ol className="space-y-2 text-sm">
              {toc.map((item, idx) => (
                <li key={item.id} className="flex items-start gap-2 text-foreground-secondary">
                  <span className="text-primary font-semibold">{String(idx + 1).padStart(2, "0")}</span>
                  <button
                    onClick={() =>
                      document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="text-left hover:text-foreground transition-colors"
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </section>

        <section id="tutorial" className="card card--space-lg scroll-mt-24">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-foreground-muted">tutorial</p>
              <h3 className="text-2xl font-semibold text-foreground">Tutorial rápido</h3>
            </div>
          </div>
          <p className="text-foreground-secondary mb-6">
            Seguí estos pasos para implementar ARJA ERP desde cero. Cada paso enlaza con rutas del panel para que
            puedas replicarlo mientras configurás el negocio.
          </p>
          <ol className="space-y-6">
            {tutorialSteps.map((step) => (
              <li key={step.title} className="border border-border rounded-2xl p-5 bg-background-secondary/40">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-primary font-semibold">{step.title.split(".")[0]}</span>
                  <h4 className="text-lg font-semibold">{step.title.slice(3)}</h4>
                </div>
                <p className="text-sm text-foreground-secondary mb-3">{step.description}</p>
                <ul className="text-sm text-foreground space-y-1">
                  {step.tips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2"></span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        {sections.map((section) => {
          const Icon = iconMap[section.icon] || Settings;
          return (
            <section
              id={section.id}
              key={section.id}
              className="card card--space-lg scroll-mt-24"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-foreground-muted">
                    {section.id}
                  </p>
                  <h3 className="text-2xl font-semibold text-foreground">
                    {section.title}
                  </h3>
                </div>
              </div>
              <p className="text-foreground-secondary mb-6">{section.description}</p>
              <ul className="space-y-3">
                {section.bullets.map((bullet, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-foreground">
                    <span className="w-2 h-2 rounded-full bg-primary mt-2"></span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="card card--space-lg">
          <h3 className="text-2xl font-semibold mb-3">¿Necesitás algo más?</h3>
          <p className="text-foreground-secondary mb-6">
            El roadmap incluye módulos de fidelización, campañas multicanal y
            reportes financieros. Si tenés un caso de uso puntual escribinos y lo sumamos
            a la documentación.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate("/onboarding")}
              className="btn-primary"
            >
              Crear cuenta de prueba
            </button>
            <button
              onClick={() => navigate("/")}
              className="btn-ghost"
            >
              Volver al sitio
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}


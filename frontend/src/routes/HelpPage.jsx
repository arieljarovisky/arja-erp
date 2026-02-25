import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Mail, MessageSquare, Book, Search } from "lucide-react";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function HelpPage() {
  const navigate = useNavigate();

  const faqs = [
    {
      question: "¿Cómo creo mi cuenta?",
      answer: "Podés crear tu cuenta haciendo clic en 'Comenzar Gratis' en la página principal. El proceso de registro es simple y te guiará paso a paso."
    },
    {
      question: "¿Cuánto tiempo dura la prueba gratuita?",
      answer: "Ofrecemos una prueba gratuita de 14 días. No necesitás tarjeta de crédito y podés cancelar en cualquier momento."
    },
    {
      question: "¿Puedo cambiar de plan después?",
      answer: "Sí, podés cambiar de plan en cualquier momento desde la configuración de tu cuenta. Los cambios se aplican inmediatamente."
    },
    {
      question: "¿Cómo funciona la integración con Mercado Pago?",
      answer: "ARJA ERP se integra directamente con Mercado Pago para que puedas aceptar pagos y señas online. Solo necesitás conectar tu cuenta una vez."
    },
    {
      question: "¿Qué pasa si necesito más profesionales?",
      answer: "Podés agregar profesionales extra como add-on o actualizar a un plan superior que incluya más profesionales."
    },
    {
      question: "¿Los datos están seguros?",
      answer: "Sí, utilizamos encriptación de nivel empresarial y realizamos respaldos automáticos diarios de toda tu información."
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="landing-nav">
        <div className="landing-nav__container">
          <div className="landing-nav__brand">
            <Logo size="default" showText={true} />
          </div>
          <div className="landing-nav__auth">
            <ThemeToggle />
            <button
              onClick={() => navigate("/")}
              className="btn-ghost btn--compact"
            >
              Volver
            </button>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
              Centro de Ayuda
            </h1>
            <p className="text-xl text-foreground-secondary">
              Encontrá respuestas a tus preguntas más frecuentes
            </p>
          </motion.div>

          {/* Búsqueda */}
          <div className="mb-12">
            <div className="input-group">
              <span className="input-group__icon">
                <Search />
              </span>
              <input
                type="text"
                className="input input--with-icon"
                placeholder="Buscar en la ayuda..."
              />
            </div>
          </div>

          {/* Secciones rápidas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="card p-6 text-center hover:scale-105 transition-transform cursor-pointer"
              onClick={() => navigate("/docs")}
            >
              <div className="w-12 h-12 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Book className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Documentación</h3>
              <p className="text-sm text-foreground-secondary">
                Guías completas y tutoriales
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="card p-6 text-center hover:scale-105 transition-transform cursor-pointer"
              onClick={() => navigate("/contact")}
            >
              <div className="w-12 h-12 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Contacto</h3>
              <p className="text-sm text-foreground-secondary">
                Escribinos y te ayudamos
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="card p-6 text-center hover:scale-105 transition-transform cursor-pointer"
            >
              <div className="w-12 h-12 bg-primary-light dark:bg-primary/20 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Chat en vivo</h3>
              <p className="text-sm text-foreground-secondary">
                Próximamente disponible
              </p>
            </motion.div>
          </div>

          {/* FAQs */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">
              Preguntas Frecuentes
            </h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * index }}
                  className="card p-6"
                >
                  <h3 className="font-semibold text-foreground mb-2">
                    {faq.question}
                  </h3>
                  <p className="text-foreground-secondary text-sm">
                    {faq.answer}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* CTA de contacto */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-8 text-center bg-background-secondary"
          >
            <h3 className="text-xl font-bold text-foreground mb-3">
              ¿No encontraste lo que buscabas?
            </h3>
            <p className="text-foreground-secondary mb-6">
              Nuestro equipo está listo para ayudarte
            </p>
            <button
              onClick={() => navigate("/contact")}
              className="btn-primary"
            >
              Contactar Soporte
            </button>
          </motion.div>
        </div>
      </main>
    </div>
  );
}


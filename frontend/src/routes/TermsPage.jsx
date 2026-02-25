import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function TermsPage() {
  const navigate = useNavigate();

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
          >
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
              Términos y Condiciones
            </h1>
            <p className="text-foreground-muted mb-8">
              Última actualización: {new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <div className="card p-8 space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">1. Aceptación de los Términos</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Al acceder y utilizar ARJA ERP, aceptás estos términos y condiciones en su totalidad. 
                  Si no estás de acuerdo con alguna parte de estos términos, no debés utilizar nuestro servicio.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">2. Descripción del Servicio</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  ARJA ERP es una plataforma de gestión empresarial que ofrece herramientas para:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Gestión de turnos y citas</li>
                  <li>Administración de clientes</li>
                  <li>Control de stock e inventario</li>
                  <li>Facturación y pagos</li>
                  <li>Reportes y análisis</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">3. Cuenta de Usuario</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Para utilizar nuestros servicios, debés crear una cuenta proporcionando información precisa y actualizada. 
                  Sos responsable de:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Mantener la confidencialidad de tu contraseña</li>
                  <li>Todas las actividades que ocurran bajo tu cuenta</li>
                  <li>Notificarnos inmediatamente sobre cualquier uso no autorizado</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">4. Planes y Facturación</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Ofrecemos diferentes planes de suscripción con características y precios variados. 
                  Los términos de facturación incluyen:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Facturación mensual o anual según el plan seleccionado</li>
                  <li>Renovación automática a menos que canceles</li>
                  <li>Reembolsos según nuestra política de cancelación</li>
                  <li>Cambios de plan disponibles en cualquier momento</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">5. Uso Aceptable</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Te comprometés a utilizar ARJA ERP únicamente para fines legales y de acuerdo con estos términos. 
                  Está prohibido:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Usar el servicio para actividades ilegales</li>
                  <li>Intentar acceder a sistemas o datos no autorizados</li>
                  <li>Interferir con el funcionamiento del servicio</li>
                  <li>Compartir tu cuenta con terceros sin autorización</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">6. Propiedad Intelectual</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Todo el contenido de ARJA ERP, incluyendo diseño, código, logos y marcas, es propiedad de ARJA ERP 
                  y está protegido por leyes de propiedad intelectual. No podés copiar, modificar o distribuir 
                  ningún contenido sin nuestro consentimiento escrito.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">7. Privacidad</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  El manejo de tus datos personales se rige por nuestra Política de Privacidad, 
                  que forma parte integral de estos términos. Podés revisarla en nuestra página de Privacidad.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">8. Limitación de Responsabilidad</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  ARJA ERP se proporciona "tal cual" sin garantías de ningún tipo. No nos hacemos responsables 
                  por pérdidas indirectas, incidentales o consecuentes derivadas del uso del servicio.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">9. Modificaciones</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Nos reservamos el derecho de modificar estos términos en cualquier momento. 
                  Las modificaciones entrarán en vigor al publicarse en esta página. 
                  Es tu responsabilidad revisar periódicamente estos términos.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">10. Contacto</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Si tenés preguntas sobre estos términos, podés contactarnos en{" "}
                  <a href="mailto:administracion@arjaerp.com.ar" className="text-primary hover:text-primary-hover">
                    administracion@arjaerp.com.ar
                  </a>
                </p>
              </section>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}


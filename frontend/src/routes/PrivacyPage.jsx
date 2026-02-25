import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function PrivacyPage() {
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
              Política de Privacidad
            </h1>
            <p className="text-foreground-muted mb-8">
              Última actualización: {new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <div className="card p-8 space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">1. Información que Recopilamos</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Recopilamos información que nos proporcionás directamente y datos generados por tu uso del servicio:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li><strong>Información de cuenta:</strong> nombre, email, teléfono</li>
                  <li><strong>Datos de negocio:</strong> información de tu empresa, sucursales, profesionales</li>
                  <li><strong>Datos de clientes:</strong> información que ingresás sobre tus clientes</li>
                  <li><strong>Datos de uso:</strong> registros de actividad, logs del sistema</li>
                  <li><strong>Información de pago:</strong> procesada de forma segura a través de Mercado Pago</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">2. Cómo Usamos tu Información</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Utilizamos la información recopilada para:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Proporcionar y mejorar nuestros servicios</li>
                  <li>Procesar pagos y gestionar suscripciones</li>
                  <li>Enviar notificaciones y comunicaciones importantes</li>
                  <li>Ofrecer soporte técnico y atención al cliente</li>
                  <li>Cumplir con obligaciones legales</li>
                  <li>Analizar el uso del servicio para mejoras</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">3. Compartir Información</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  No vendemos tu información personal. Solo compartimos datos en las siguientes situaciones:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li><strong>Proveedores de servicios:</strong> empresas que nos ayudan a operar (hosting, email, pagos)</li>
                  <li><strong>Cumplimiento legal:</strong> cuando es requerido por ley o autoridades</li>
                  <li><strong>Con tu consentimiento:</strong> en cualquier otra situación con tu autorización explícita</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">4. Seguridad de los Datos</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Implementamos medidas de seguridad técnicas y organizativas para proteger tu información:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4 mt-4">
                  <li>Encriptación de datos en tránsito y en reposo</li>
                  <li>Acceso restringido a información sensible</li>
                  <li>Respaldos automáticos y redundancia</li>
                  <li>Monitoreo continuo de seguridad</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">5. Tus Derechos</h2>
                <p className="text-foreground-secondary leading-relaxed mb-4">
                  Tenés derecho a:
                </p>
                <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                  <li>Acceder a tus datos personales</li>
                  <li>Rectificar información incorrecta</li>
                  <li>Solicitar la eliminación de tus datos</li>
                  <li>Oponerte al procesamiento de tus datos</li>
                  <li>Exportar tus datos en formato estándar</li>
                  <li>Retirar tu consentimiento en cualquier momento</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">6. Cookies y Tecnologías Similares</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Utilizamos cookies y tecnologías similares para mejorar tu experiencia, analizar el uso del servicio 
                  y personalizar contenido. Podés gestionar las preferencias de cookies desde la configuración de tu navegador.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">7. Retención de Datos</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Conservamos tu información mientras tu cuenta esté activa o según sea necesario para cumplir con 
                  nuestras obligaciones legales. Cuando cancelás tu cuenta, eliminamos o anonimizamos tus datos 
                  personales según nuestra política de retención.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">8. Transferencias Internacionales</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Tus datos pueden ser procesados y almacenados en servidores ubicados fuera de Argentina. 
                  Nos aseguramos de que estas transferencias cumplan con las leyes de protección de datos aplicables.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">9. Menores de Edad</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  ARJA ERP no está dirigido a menores de 18 años. No recopilamos intencionalmente información 
                  de menores. Si descubrimos que hemos recopilado datos de un menor, los eliminaremos inmediatamente.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">10. Cambios a esta Política</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Podemos actualizar esta política ocasionalmente. Te notificaremos sobre cambios significativos 
                  por email o mediante un aviso en el servicio. La fecha de "última actualización" indica cuándo 
                  se realizó la última revisión.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-foreground mb-4">11. Contacto</h2>
                <p className="text-foreground-secondary leading-relaxed">
                  Si tenés preguntas sobre esta política de privacidad o sobre el manejo de tus datos personales, 
                  contactanos en{" "}
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


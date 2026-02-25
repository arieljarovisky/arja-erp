import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import { CheckCircle2 } from "lucide-react";
import apiClient from "../api/client";
import { logger } from "../utils/logger.js";

export default function EnterpriseRequest() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    teamSize: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiClient.post("/public/enterprise/request", form);
      setSubmitted(true);
    } catch (err) {
      logger.error("Error enviando solicitud Pro a medida:", err);
      setError("No pudimos enviar tu solicitud. Probá nuevamente en unos minutos.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <nav className="landing-nav">
          <div className="landing-nav__container">
            <div className="landing-nav__brand">
              <Logo size="default" showText={true} />
            </div>
            <div className="landing-nav__auth">
              <ThemeToggle />
            </div>
          </div>
        </nav>
        <main className="pt-32 px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto card card--space-xl text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-12 h-12 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-3">
              ¡Solicitud enviada!
            </h1>
            <p className="text-foreground-secondary">
              Nuestro equipo evaluará tu caso de “Pro a medida” y se pondrá en contacto
              contigo en breve.
            </p>
            <div className="mt-8">
              <button onClick={() => navigate("/")} className="btn-primary">
                Volver a la página principal
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="landing-nav">
        <div className="landing-nav__container">
          <div className="landing-nav__brand">
            <Logo size="default" showText={true} />
          </div>
          <div className="landing-nav__auth">
            <ThemeToggle />
          </div>
        </div>
      </nav>
      <main className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-3">
              Solicitud “Pro a medida”
            </h1>
            <p className="text-foreground-secondary">
              Completa el formulario y nuestro equipo evaluará tu implementación.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="card card--space-lg grid gap-5">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-foreground-secondary mb-2">Nombre y apellido</label>
                <input
                  className="input"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-foreground-secondary mb-2">Email</label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-foreground-secondary mb-2">Teléfono</label>
                <input
                  className="input"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm text-foreground-secondary mb-2">Empresa/Negocio</label>
                <input
                  className="input"
                  name="company"
                  value={form.company}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-foreground-secondary mb-2">Tamaño del equipo</label>
              <select
                className="input"
                name="teamSize"
                value={form.teamSize}
                onChange={handleChange}
              >
                <option value="">Seleccionar</option>
                <option value="1-5">1–5</option>
                <option value="6-15">6–15</option>
                <option value="16-30">16–30</option>
                <option value="31-60">31–60</option>
                <option value="61+">61+</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-foreground-secondary mb-2">Descripción del proyecto</label>
              <textarea
                className="input"
                rows="5"
                name="message"
                value={form.message}
                onChange={handleChange}
                placeholder="Contexto, integraciones necesarias, plazos, etc."
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => navigate("/")} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Enviando..." : "Enviar solicitud"}
              </button>
            </div>
            {error && (
              <p className="text-sm text-red-500 mt-2">
                {error}
              </p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}



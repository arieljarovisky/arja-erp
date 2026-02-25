// src/routes/BookingPage.jsx
import { useState, useEffect } from "react";
import BookingWidget from "../components/BookingWidget";
import CalendarView from "../components/CalendarView";
import { Calendar, X, Plus } from "lucide-react";

export default function BookingPage() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Cerrar drawer con Escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isDrawerOpen]);

  // Prevenir scroll del body cuando el drawer está abierto
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDrawerOpen]);

  return (
    <div className="min-h-screen bg-background relative">
      {/* Header */}
      <div className="max-w-full mx-auto px-4 md:px-6 py-4 md:py-6 border-b border-border/50">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 rounded-xl bg-indigo-500/10 ring-1 ring-indigo-500/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-foreground-secondary">Sistema activo</span>
              </div>
            </div>
          </div>
          
          {/* Botón para abrir drawer */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="group relative px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/40 transition-all duration-300 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>Reservar Turno</span>
          </button>
        </div>
      </div>

      {/* Calendario a pantalla completa */}
      <div className="w-full">
        <CalendarView />
      </div>

      {/* Overlay oscuro cuando el drawer está abierto */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300"
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer lateral desde la derecha */}
      <div
        className={`fixed top-0 right-0 h-full w-full md:w-[600px] lg:w-[700px] bg-background shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header del drawer */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-foreground">Reservar Turno</h2>
          <button
            onClick={() => setIsDrawerOpen(false)}
            className="p-2 rounded-lg hover:bg-background-secondary transition-colors text-foreground-secondary hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Contenido del drawer con scroll */}
        <div className="h-[calc(100vh-73px)] overflow-y-auto">
          <div className="p-4 md:p-6">
            <BookingWidget />
          </div>
        </div>
      </div>
    </div>
  );
}

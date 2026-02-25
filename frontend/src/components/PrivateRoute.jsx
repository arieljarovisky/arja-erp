// src/components/PrivateRoute.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getAccessToken } from "../api/client";

export default function PrivateRoute({ children, roles }) {
  const { user, authLoaded } = useAuth();
  const token = getAccessToken();

  // Esperar que se cargue el contexto de autenticación
  if (!authLoaded) return null; // o un loader/spinner

  // Si no hay usuario ni token → forzar login
  if (!user && !token) return <Navigate to="/login" replace />;

  // Verificar roles si están definidos
  if (Array.isArray(roles) && roles.length) {
    const ok = user && roles.includes(user.role);
    if (!ok) return <Navigate to="/login" replace />;
  }

  // Si llega acá, está autenticado y autorizado
  return children;
}

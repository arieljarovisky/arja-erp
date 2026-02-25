import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getAccessToken } from "../api/client";

export default function SuperAdminRoute({ children }) {
  const { user, tenant, authLoaded } = useAuth();
  const token = getAccessToken();
  const location = useLocation();

  if (!authLoaded) return null;

  if (!user && !token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ next: location.pathname + location.search }}
      />
    );
  }

  if (!user?.isSuperAdmin) {
    const fallbackSlug = tenant?.slug || tenant?.subdomain;
    const fallback = fallbackSlug ? `/${fallbackSlug}/dashboard` : "/login";
    return <Navigate to={fallback} replace />;
  }

  return children;
}


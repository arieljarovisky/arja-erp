import React from "react";
import { logger } from "../utils/logger.js";
import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Si es un error de DOM durante traducción, intentar recuperarse automáticamente
    if (error?.name === 'NotFoundError' && 
        (error?.message?.includes('removeChild') || error?.message?.includes('insertBefore')) &&
        typeof document !== 'undefined' &&
        (document.documentElement.classList.contains('translated-ltr') ||
         document.documentElement.classList.contains('translated-rtl'))) {
      // No mostrar error para estos casos, solo loguear
      logger.warn("Error de DOM durante traducción automática (ignorado):", error);
      return { hasError: false, error: null, errorInfo: null };
    }
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Ignorar errores de DOM durante traducciones automáticas
    if (error?.name === 'NotFoundError' && 
        (error?.message?.includes('removeChild') || error?.message?.includes('insertBefore')) &&
        typeof document !== 'undefined' &&
        (document.documentElement.classList.contains('translated-ltr') ||
         document.documentElement.classList.contains('translated-rtl'))) {
      logger.warn("Error de DOM durante traducción automática (ignorado):", error);
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
      });
      return;
    }
    
    logger.error("ErrorBoundary capturó un error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} errorInfo={this.state.errorInfo} />;
    }

    return this.props.children;
  }
}

function ErrorFallback({ error, errorInfo }) {
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="card p-8 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Algo salió mal
              </h1>
              <p className="text-foreground-muted mt-1">
                Ocurrió un error inesperado en la aplicación
              </p>
            </div>
          </div>

          {isDev && error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-mono text-red-800 dark:text-red-200 break-all">
                {error.toString()}
              </p>
              {errorInfo?.componentStack && (
                <details className="mt-2">
                  <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer">
                    Stack trace
                  </summary>
                  <pre className="mt-2 text-xs text-red-700 dark:text-red-300 overflow-auto max-h-48">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 btn-primary py-3 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Recargar página
            </button>
            <button
              onClick={() => navigate("/")}
              className="flex-1 btn-ghost py-3 flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              Ir al inicio
            </button>
          </div>

          <div className="text-center text-sm text-foreground-muted">
            <p>
              Si el problema persiste,{" "}
              <button
                onClick={() => navigate("/contact")}
                className="text-primary hover:text-primary-hover font-medium"
              >
                contactanos
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;


import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api/client.js";
import { ShoppingCart, Store, PlugZap, Unplug } from "lucide-react";

const PROVIDERS = [
  {
    key: "tienda_nube",
    name: "Tienda Nube",
    description: "Sincronizá pedidos, clientes y productos automáticamente.",
    scopes: "read_orders, read_products, read_customers",
    icon: Store,
    docsUrl: "https://tiendanube.com/ayuda",
  },
  {
    key: "mercado_libre",
    name: "Mercado Libre",
    description: "Traé ventas confirmadas y facturalas con un clic.",
    scopes: "orders.read, shipments.read, offline_access",
    icon: ShoppingCart,
    docsUrl: "https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion",
  },
];

export default function IntegrationsPage() {
  const [actionLoading, setActionLoading] = useState(null);

  const {
    data: integrations = [],
    loading,
    error,
    refetch,
  } = useQuery(
    async () => {
      const res = await apiClient.get("/api/ecommerce/integrations/status");
      return res.data?.data || [];
    },
    []
  );

  const statusMap = useMemo(() => {
    return integrations.reduce((acc, current) => {
      acc[current.provider] = current;
      return acc;
    }, {});
  }, [integrations]);

  const handleConnect = async (provider) => {
    try {
      setActionLoading(provider + "-connect");
      const response = await apiClient.post(`/api/ecommerce/integrations/${provider}/start`);
      const url = response.data?.data?.authorizeUrl;
      if (!url) throw new Error("No recibimos la URL de autorización");
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Seguinos en la ventana emergente para completar la conexión.");
    } catch (err) {
      const message = err.response?.data?.error || err.message || "No pudimos iniciar la conexión.";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (provider) => {
    try {
      setActionLoading(provider + "-disconnect");
      await apiClient.post(`/api/ecommerce/integrations/${provider}/disconnect`);
      toast.success("Integración desconectada.");
      refetch();
    } catch (err) {
      const message =
        err.response?.data?.error || err.message || "No pudimos desconectar la integración.";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <p className="text-sm text-foreground-secondary mb-1">Integraciones</p>
        <h1 className="text-3xl font-semibold text-foreground mb-2">Ventas Online</h1>
        <p className="text-foreground-muted text-sm">
          Permití que cada sucursal conecte su Tienda Nube o Mercado Libre para traer pedidos sin
          trabajo manual.
        </p>
      </header>

      {loading && (
        <div className="card p-6 text-sm text-foreground-secondary">Cargando integraciones...</div>
      )}
      {error && (
        <div className="card p-6 text-sm text-red-300">
          No pudimos obtener el estado de las integraciones.
        </div>
      )}

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          const status = statusMap[provider.key];
          const isConnected = status?.status === "connected";
          const expiresLabel = status?.expires_at
            ? new Date(status.expires_at).toLocaleString("es-AR")
            : null;
          return (
            <article key={provider.key} className="card p-5 space-y-4 border border-border/60">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary rounded-xl p-2 w-11 h-11 flex items-center justify-center">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">{provider.name}</h2>
                  <p className="text-sm text-foreground-muted">{provider.description}</p>
                </div>
              </div>

              <dl className="text-sm text-foreground-muted space-y-2">
                <div className="flex items-center justify-between">
                  <dt>Estado</dt>
                  <dd>
                    {isConnected ? (
                      <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-300">
                        Conectado
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-200">
                        Desconectado
                      </span>
                    )}
                  </dd>
                </div>
                {status?.external_store_id && (
                  <div className="flex items-center justify-between">
                    <dt>ID de tienda</dt>
                    <dd className="text-foreground">{status.external_store_id}</dd>
                  </div>
                )}
                {status?.external_user_id && (
                  <div className="flex items-center justify-between">
                    <dt>Usuario externo</dt>
                    <dd className="text-foreground">{status.external_user_id}</dd>
                  </div>
                )}
                {expiresLabel && (
                  <div className="flex items-center justify-between">
                    <dt>Expira</dt>
                    <dd className="text-foreground">{expiresLabel}</dd>
                  </div>
                )}
                {status?.last_error && (
                  <div className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                    Último error: {status.last_error}
                  </div>
                )}
              </dl>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary flex items-center gap-2"
                  onClick={() => handleConnect(provider.key)}
                  disabled={actionLoading?.startsWith(provider.key)}
                >
                  <PlugZap className="w-4 h-4" />
                  {isConnected ? "Reconectar" : "Conectar"}
                </button>
                {isConnected && (
                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => handleDisconnect(provider.key)}
                    disabled={actionLoading?.startsWith(provider.key)}
                  >
                    <Unplug className="w-4 h-4" />
                    Desconectar
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}


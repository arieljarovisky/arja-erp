import { useState } from "react";
import { useQuery } from "../../shared/useQuery.js";
import { apiClient } from "../../api";
import { DollarSign, Package, TrendingUp } from "lucide-react";
import { logger } from "../../utils/logger.js";

export default function StockValuationPage() {
  const [branchFilter, setBranchFilter] = useState("");

  // Cargar valuación
  const { data: valuationData, loading: loadingValuation } = useQuery(
    async () => {
      try {
        const params = {};
        if (branchFilter) params.branch_id = branchFilter;
        const result = await apiClient.getInventoryValuation(params);
        // getInventoryValuation devuelve un objeto directamente
        return result && typeof result === 'object' ? result : {};
      } catch (error) {
        logger.error("Error al cargar valuación:", error);
        return {};
      }
    },
    [branchFilter]
  );
  const valuation = valuationData && typeof valuationData === 'object' ? valuationData : {};

  // Cargar detalle
  const { data: detailData, loading: loadingDetail } = useQuery(
    async () => {
      try {
        const params = {};
        if (branchFilter) params.branch_id = branchFilter;
        const result = await apiClient.getInventoryValuationDetail(params);
        // getInventoryValuationDetail ya devuelve el array directamente
        return Array.isArray(result) ? result : [];
      } catch (error) {
        logger.error("Error al cargar detalle de valuación:", error);
        return [];
      }
    },
    [branchFilter]
  );
  const detail = Array.isArray(detailData) ? detailData : [];

  // Cargar sucursales
  const { data: branchesData } = useQuery(
    async () => {
      try {
        const response = await apiClient.listActiveBranches();
        return Array.isArray(response?.data) ? response.data : [];
      } catch (error) {
        logger.error("Error al cargar sucursales:", error);
        return [];
      }
    },
    []
  );
  const branches = Array.isArray(branchesData) ? branchesData : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Valuación de Inventario</h1>
          <p className="text-sm sm:text-base text-foreground-secondary">
            Visualiza el valor total de tu inventario
          </p>
        </div>
      </div>

      {/* Filtros */}
      {branches.length > 1 && (
        <div className="card p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
                Filtrar por Sucursal
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="input w-full sm:w-60"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Resumen de valuación */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-foreground-muted">Valor Total</span>
            <DollarSign className="w-5 h-5 text-primary" />
          </div>
          <p className="text-3xl font-bold text-foreground">
            ${Number(valuation.total_inventory_value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-foreground-muted">Valor Disponible</span>
            <TrendingUp className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-3xl font-bold text-foreground">
            ${Number(valuation.available_inventory_value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-foreground-muted">Productos</span>
            <Package className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-foreground">
            {valuation.product_count || 0}
          </p>
        </div>
      </div>

      {/* Detalle */}
      {loadingDetail ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-foreground-secondary mt-4">Cargando detalle...</p>
        </div>
      ) : detail.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-foreground-muted" />
          <p className="text-foreground-secondary">No hay productos con costos configurados</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-background-secondary">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Producto</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Sucursal</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Cantidad</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Disponible</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Costo Unit.</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Valor Total</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Valor Disp.</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((item) => (
                  <tr key={`${item.product_id}-${item.branch_id}`} className="border-b border-border hover:bg-background-secondary transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{item.product_name}</div>
                      <div className="text-xs text-foreground-muted">{item.product_code}</div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground-secondary">
                      {item.branch_name || "Sin asignar"}
                    </td>
                    <td className="py-3 px-4 text-right text-foreground">
                      {Number(item.quantity).toLocaleString('es-AR')}
                    </td>
                    <td className="py-3 px-4 text-right text-foreground">
                      {Number(item.available_quantity).toLocaleString('es-AR')}
                    </td>
                    <td className="py-3 px-4 text-right text-foreground">
                      ${Number(item.unit_cost).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-foreground">
                      ${Number(item.total_value).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-green-600 dark:text-green-400">
                      ${Number(item.available_value).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


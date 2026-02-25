import { useState, useEffect } from "react";
import { X, Package, Plus, Minus, Search, User } from "lucide-react";
import { apiClient } from "../../api";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { logger } from "../../utils/logger.js";

export function InvoiceProductsModal({ onClose, customers, constants, onInvoice }) {
  const { user: currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProducts, setSelectedProducts] = useState({}); // { productId: { quantity, price } }
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [groupByCustomer, setGroupByCustomer] = useState(false);

  // Cargar productos del stock y usuarios
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Cargar productos
        const productsResponse = await apiClient.get("/api/stock/products");
        const productsData = productsResponse.data?.data || productsResponse.data || [];
        setProducts(productsData.filter(p => p.active !== false));
        
        // Cargar usuarios (vendedores)
        try {
          const usersResponse = await apiClient.get("/api/users");
          const usersData = usersResponse.data?.data || usersResponse.data || [];
          setUsers(usersData.filter(u => u.active !== false));
          // Establecer el usuario actual como vendedor por defecto
          if (currentUser?.id && !selectedSellerId) {
            setSelectedSellerId(currentUser.id.toString());
          }
        } catch (error) {
          logger.warn("Error cargando usuarios:", error);
          // No mostrar error, simplemente no habrá selector de vendedor
        }
      } catch (error) {
        logger.error("Error cargando productos:", error);
        toast.error("Error al cargar productos");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [currentUser?.id]);

  const filteredProducts = products.filter(product =>
    product.name?.toLowerCase().includes(search.toLowerCase()) ||
    product.code?.toLowerCase().includes(search.toLowerCase())
  );

  const handleProductSelect = (productId, product) => {
    setSelectedProducts(prev => {
      const current = prev[productId] || { quantity: 1, price: parseFloat(product.sale_price || product.price || 0) };
      return {
        ...prev,
        [productId]: current
      };
    });
  };

  const updateProductQuantity = (productId, delta) => {
    setSelectedProducts(prev => {
      const current = prev[productId];
      if (!current) return prev;
      const newQuantity = Math.max(1, (current.quantity || 1) + delta);
      return {
        ...prev,
        [productId]: { ...current, quantity: newQuantity }
      };
    });
  };

  const updateProductPrice = (productId, price) => {
    setSelectedProducts(prev => {
      const current = prev[productId];
      if (!current) return prev;
      return {
        ...prev,
        [productId]: { ...current, price: parseFloat(price) || 0 }
      };
    });
  };

  const removeProduct = (productId) => {
    setSelectedProducts(prev => {
      const newState = { ...prev };
      delete newState[productId];
      return newState;
    });
  };

  const calculateTotal = () => {
    return Object.entries(selectedProducts).reduce((sum, [productId, data]) => {
      const product = products.find(p => p.id === parseInt(productId));
      if (!product) return sum;
      return sum + (data.price * data.quantity);
    }, 0);
  };

  const handleInvoice = async () => {
    if (Object.keys(selectedProducts).length === 0) {
      toast.error("Selecciona al menos un producto");
      return;
    }

    if (groupByCustomer && !selectedCustomerId) {
      toast.error("Selecciona un cliente");
      return;
    }

    try {
      setLoading(true);

      // Preparar items para facturar
      const items = Object.entries(selectedProducts).map(([productId, data]) => {
        const product = products.find(p => p.id === parseInt(productId));
        return {
          descripcion: product.name || `Producto ${productId}`,
          cantidad: data.quantity,
          precio_unitario: data.price,
          alicuota_iva: 21, // IVA por defecto
          codigo: product.code || null,
          product_id: productId, // Para descontar del stock después
        };
      });

      const importe_neto = items.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
      const importe_iva = importe_neto * 0.21;
      const importe_total = importe_neto + importe_iva;

      const customer = customers.find(c => c.id === parseInt(selectedCustomerId));

      // Llamar a la API para facturar
      const response = await apiClient.post("/api/invoicing/arca/generate", {
        tipo_comprobante: 1, // Factura A
        customer_id: customer?.id || null,
        items: items,
        importe_neto: importe_neto,
        importe_iva: importe_iva,
        importe_total: importe_total,
        concepto: constants?.CONCEPTOS?.PRODUCTOS || 1,
        tipo_doc_cliente: customer?.documento?.length === 11 ? 80 : 96,
        doc_cliente: customer?.documento || "00000000",
        razon_social: customer?.name || "Consumidor Final",
        condicion_iva: constants?.CONDICIONES_IVA?.CONSUMIDOR_FINAL || 5,
        product_ids: Object.keys(selectedProducts).map(id => parseInt(id)), // IDs de productos facturados
        seller_id: selectedSellerId ? parseInt(selectedSellerId) : null, // ID del vendedor
      });

      if (response.data?.ok) {
        toast.success("Productos facturados correctamente");
        onInvoice?.();
        onClose();
      } else {
        toast.error(response.data?.error || "Error al facturar productos");
      }
    } catch (error) {
      logger.error("Error al facturar productos:", error);
      toast.error(error.response?.data?.error || "Error al facturar productos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">Facturar Productos</h2>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost btn--compact"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Cliente */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Cliente (opcional)
            </label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="input w-full"
            >
              <option value="">Consumidor Final</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.documento ? `(${customer.documento})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Vendedor */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <User className="w-4 h-4 inline mr-2" />
              Vendedor
            </label>
            <select
              value={selectedSellerId}
              onChange={(e) => setSelectedSellerId(e.target.value)}
              className="input w-full"
            >
              <option value="">Sin vendedor</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email} {user.role === "admin" ? "(Admin)" : user.role === "staff" ? "(Staff)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-foreground-muted mt-1">
              El vendedor recibirá comisión por esta venta
            </p>
          </div>

          {/* Buscar productos */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Buscar Productos
            </label>
            <div className="input-group">
              <span className="input-group__icon">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o código..."
                className="input input--with-icon"
              />
            </div>
          </div>

          {/* Lista de productos */}
          {loading ? (
            <div className="text-center py-8 text-foreground-muted">
              Cargando productos...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-foreground-muted">
              No se encontraron productos
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProducts.map((product) => {
                const isSelected = selectedProducts[product.id];
                const stock = product.stock || 0;
                const price = parseFloat(product.sale_price || product.price || 0);

                return (
                  <div
                    key={product.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => handleProductSelect(product.id, product)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-medium text-foreground">{product.name}</h3>
                        {product.code && (
                          <p className="text-sm text-foreground-muted">Código: {product.code}</p>
                        )}
                        <p className="text-sm text-foreground-muted">
                          Stock: {stock} | Precio: ${price.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      {isSelected && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProduct(product.id);
                          }}
                          className="btn-ghost btn--compact"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-border space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-foreground-muted w-20">Cantidad:</label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateProductQuantity(product.id, -1);
                              }}
                              className="btn-ghost btn--compact"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={stock}
                              value={selectedProducts[product.id].quantity}
                              onChange={(e) => {
                                const qty = Math.max(1, Math.min(stock, parseInt(e.target.value) || 1));
                                setSelectedProducts(prev => ({
                                  ...prev,
                                  [product.id]: { ...prev[product.id], quantity: qty }
                                }));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="input w-20 text-center"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateProductQuantity(product.id, 1);
                              }}
                              disabled={selectedProducts[product.id].quantity >= stock}
                              className="btn-ghost btn--compact"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-foreground-muted w-20">Precio:</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={selectedProducts[product.id].price}
                            onChange={(e) => {
                              updateProductPrice(product.id, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="input flex-1"
                          />
                        </div>
                        <div className="text-right text-sm font-medium text-foreground">
                          Subtotal: ${(selectedProducts[product.id].price * selectedProducts[product.id].quantity).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Resumen de productos seleccionados */}
          {Object.keys(selectedProducts).length > 0 && (
            <div className="border-t border-border pt-4">
              <h3 className="font-semibold text-foreground mb-3">Resumen</h3>
              <div className="space-y-2">
                {Object.entries(selectedProducts).map(([productId, data]) => {
                  const product = products.find(p => p.id === parseInt(productId));
                  if (!product) return null;
                  return (
                    <div key={productId} className="flex items-center justify-between p-2 bg-background-secondary rounded">
                      <span className="text-sm text-foreground">
                        {product.name} x{data.quantity}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        ${(data.price * data.quantity).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <span className="font-semibold text-foreground">Total:</span>
                <span className="text-xl font-bold text-primary">
                  ${calculateTotal().toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={onClose}
            className="btn-ghost"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleInvoice}
            disabled={loading || Object.keys(selectedProducts).length === 0}
            className="btn-primary"
          >
            {loading ? "Facturando..." : `Facturar $${calculateTotal().toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
          </button>
        </div>
      </div>
    </div>
  );
}


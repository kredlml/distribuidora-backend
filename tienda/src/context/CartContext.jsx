import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const KEY = "carrito_tienda";
export const MAX_POR_PRENDA = 20; // igual que el límite del backend por línea

function leer() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && Array.isArray(c.items)) return c;
  } catch { /* sin almacenamiento o dato corrupto */ }
  return { items: [], id_sucursal: null };
}

/**
 * Carrito del cliente y sucursal desde la que se despacha (un pedido sale de una sola sucursal).
 * Cada item guarda una copia de los datos visibles de la variante; el precio final siempre lo
 * calcula el backend al crear el pedido.
 */
export function CartProvider({ children }) {
  const [carrito, setCarrito] = useState(leer);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(carrito)); } catch { /* sin almacenamiento */ }
  }, [carrito]);

  const agregar = useCallback((variante, prenda, cantidad = 1) => {
    setCarrito((c) => {
      const existente = c.items.find((i) => i.id_producto === variante.id_producto);
      const items = existente
        ? c.items.map((i) => (i.id_producto === variante.id_producto ? { ...i, cantidad: Math.min(MAX_POR_PRENDA, i.cantidad + cantidad) } : i))
        : [...c.items, {
          id_producto: variante.id_producto, id_prenda: prenda.id_prenda, nombre: prenda.nombre,
          talla: variante.talla, color: variante.color, precio_unitario: variante.precio_unitario,
          imagen_url: variante.imagen_url || prenda.imagen_url, cantidad: Math.min(MAX_POR_PRENDA, cantidad),
        }];
      return { ...c, items };
    });
  }, []);

  const cambiarCantidad = useCallback((id_producto, cantidad) => {
    setCarrito((c) => ({ ...c, items: c.items.map((i) => (i.id_producto === id_producto ? { ...i, cantidad: Math.max(1, Math.min(MAX_POR_PRENDA, cantidad)) } : i)) }));
  }, []);
  const actualizarItem = useCallback((id_producto, datos) => {
    setCarrito((c) => ({ ...c, items: c.items.map((i) => (i.id_producto === id_producto ? { ...i, ...datos } : i)) }));
  }, []);
  const quitar = useCallback((id_producto) => setCarrito((c) => ({ ...c, items: c.items.filter((i) => i.id_producto !== id_producto) })), []);
  const vaciar = useCallback(() => setCarrito((c) => ({ ...c, items: [] })), []);
  const elegirSucursal = useCallback((id_sucursal) => setCarrito((c) => ({ ...c, id_sucursal: id_sucursal ? Number(id_sucursal) : null })), []);

  const value = useMemo(() => ({
    items: carrito.items,
    id_sucursal: carrito.id_sucursal,
    unidades: carrito.items.reduce((s, i) => s + i.cantidad, 0),
    subtotal: Math.round(carrito.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0) * 100) / 100,
    agregar, cambiarCantidad, actualizarItem, quitar, vaciar, elegirSucursal,
  }), [carrito, agregar, cambiarCantidad, actualizarItem, quitar, vaciar, elegirSucursal]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

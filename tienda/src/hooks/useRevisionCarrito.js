import { useEffect, useMemo } from "react";
import { useCart } from "../context/CartContext";
import * as catalogoService from "../services/catalogoService";
import useFetch from "./useFetch";

/**
 * Compara el carrito con el catálogo actual de la sucursal elegida: actualiza precios que
 * cambiaron y marca prendas sin stock suficiente o que ya no se venden.
 * Devuelve { loading, error, problemas: { [id_producto]: texto }, listo }.
 */
export default function useRevisionCarrito() {
  const { items, id_sucursal, actualizarItem } = useCart();
  const catalogo = useFetch(() => catalogoService.listar({ id_sucursal }), [id_sucursal], !!id_sucursal && items.length > 0);

  const variantes = useMemo(() => {
    const m = new Map();
    (catalogo.data || []).forEach((p) => p.variantes.forEach((v) => m.set(v.id_producto, v)));
    return m;
  }, [catalogo.data]);

  useEffect(() => {
    if (!catalogo.data) return;
    items.forEach((i) => {
      const v = variantes.get(i.id_producto);
      if (v && v.precio_unitario !== i.precio_unitario) actualizarItem(i.id_producto, { precio_unitario: v.precio_unitario });
    });
  }, [catalogo.data, variantes, items, actualizarItem]);

  const problemas = {};
  if (catalogo.data) {
    items.forEach((i) => {
      const v = variantes.get(i.id_producto);
      if (!v) problemas[i.id_producto] = "Esta prenda ya no está a la venta. Quítala para continuar.";
      else if (v.stock <= 0) problemas[i.id_producto] = "Sin existencias en la sucursal elegida.";
      else if (v.stock < i.cantidad) problemas[i.id_producto] = `Solo quedan ${v.stock} en la sucursal elegida.`;
    });
  }

  return {
    loading: catalogo.loading,
    error: catalogo.error,
    problemas,
    listo: !!catalogo.data && items.length > 0 && Object.keys(problemas).length === 0,
    reload: catalogo.reload,
  };
}

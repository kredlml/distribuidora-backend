import { api } from "./api";

export function listar({ q, id_categoria, id_sucursal } = {}) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (id_categoria) p.set("id_categoria", id_categoria);
  if (id_sucursal) p.set("id_sucursal", id_sucursal);
  const qs = p.toString();
  return api("/api/tienda/catalogo" + (qs ? "?" + qs : ""));
}
export const prenda = (id) => api(`/api/tienda/catalogo/${encodeURIComponent(id)}`);
export const categorias = () => api("/api/categorias");
export const sucursales = () => api("/api/sucursales").then((l) => (l || []).filter((s) => s.activo));

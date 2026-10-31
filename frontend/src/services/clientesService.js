import { api } from "./api";

/** Lista completa (para elegir clienta en ventas y solicitudes). */
export const listar = () => api("/api/clientes");
/** Listado paginado del panel: { q, filtro: ""|web|mostrador|inactivos, pagina } -> { datos, total, pagina, paginas }. */
export const listarPagina = ({ q = "", filtro = "", pagina = 1 } = {}) => {
  const p = new URLSearchParams({ pagina: String(pagina) });
  if (q) p.set("q", q);
  if (filtro) p.set("filtro", filtro);
  return api(`/api/clientes?${p}`);
};
/** Clienta registrada en otra sucursal: búsqueda exacta por correo (devuelve [] o [cliente]). */
export const buscarPorCorreo = (email) => api(`/api/clientes?email=${encodeURIComponent(email)}`);
export const crear = (body) => api("/api/clientes", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/clientes/${id}`, { method: "PUT", body });
/** Código de un solo uso para que un cliente de mostrador active su cuenta en la tienda. */
export const generarCodigoWeb = (id) => api(`/api/clientes/${id}/codigo-web`, { method: "POST" });

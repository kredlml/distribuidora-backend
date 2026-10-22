import { api } from "./api";

export const listar = () => api("/api/inventario");
/** Stock DISPONIBLE sumado por prenda y sucursal: [{ id_producto, id_sucursal, stock_total }] */
export const stockDisponible = () => api("/api/inventario/stock");
export const deSucursal = (id) => api(`/api/inventario?id_sucursal=${encodeURIComponent(id)}`);
export const ingresar = (body) => api("/api/inventario", { method: "POST", body });
/** Baja de stock: { id_sucursal, motivo, observacion, ajustes: [{ id_inventario, cantidad_actual, cantidad_nueva }] } */
export const ajustar = (body) => api("/api/inventario/ajustes", { method: "POST", body });

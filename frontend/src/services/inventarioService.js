import { api } from "./api";

export const listar = () => api("/api/inventario");
/** Stock DISPONIBLE sumado por prenda y sucursal: [{ id_producto, id_sucursal, stock_total }] */
export const stockDisponible = () => api("/api/inventario/stock");
export const deSucursal = (id) => api(`/api/inventario?id_sucursal=${encodeURIComponent(id)}`);
export const ingresar = (body) => api("/api/inventario", { method: "POST", body });
/** Ingreso de mercadería con varias prendas y su comprobante de entrada:
 *  { id_sucursal, id_proveedor?, documento_proveedor?, observacion?, lineas: [{ id_producto, cantidad, estado, lote, costo_unitario }] } */
export const ingresarMercaderia = (body) => api("/api/inventario/ingresos", { method: "POST", body });
/** Baja de stock: { id_sucursal, motivo, observacion, ajustes: [{ id_inventario, cantidad_actual, cantidad_nueva }] } */
export const ajustar = (body) => api("/api/inventario/ajustes", { method: "POST", body });

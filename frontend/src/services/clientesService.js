import { api } from "./api";

export const listar = () => api("/api/clientes");
export const crear = (body) => api("/api/clientes", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/clientes/${id}`, { method: "PUT", body });
/** Código de un solo uso para que un cliente de mostrador active su cuenta en la tienda. */
export const generarCodigoWeb = (id) => api(`/api/clientes/${id}/codigo-web`, { method: "POST" });

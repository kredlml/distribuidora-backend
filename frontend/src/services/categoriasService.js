import { api } from "./api";

export const listar = () => api("/api/categorias");
export const crear = (body) => api("/api/categorias", { method: "POST", body });

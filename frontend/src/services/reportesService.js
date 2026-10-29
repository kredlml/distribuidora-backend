import { api } from "./api";

/** Tablero de ventas: { desde, hasta, id_sucursal? } (fechas AAAA-MM-DD, días de Guatemala). */
export const resumen = ({ desde, hasta, id_sucursal }) => {
  const p = new URLSearchParams({ desde, hasta });
  if (id_sucursal) p.set("id_sucursal", id_sucursal);
  return api(`/api/reportes/resumen?${p}`);
};

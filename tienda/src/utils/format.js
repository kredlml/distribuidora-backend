const MONEDA = new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" });

export const dinero = (v) => MONEDA.format(Number(v) || 0);

export const fecha = (v, conHora = false) => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleString("es-GT", conHora ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : "—";
};

/** "Camisa · M · Azul" */
export const variante = (x) => [x.talla && `Talla ${x.talla}`, x.color].filter(Boolean).join(" · ");

/** Foto de un producto; si la variante no tiene, la de su prenda base (ProductoPadre). */
export const fotoDe = (p) => (p ? p.imagen_url || (p.ProductoPadre && p.ProductoPadre.imagen_url) || null : null);

export const rangoPrecio = (p) => (p.precio_min === p.precio_max ? dinero(p.precio_min) : `Desde ${dinero(p.precio_min)}`);

const ACENTOS = [["cambio talla", "cambio de talla"], ["cambio variante", "cambio de variante"], ["devolucion", "devolución"], ["reintegracion", "reintegración"], ["revision", "revisión"], ["danado", "dañado"], ["envio", "envío"], ["danada", "dañada"], ["cancelacion", "cancelación"], ["ajuste salida", "baja por ajuste"]];

export const humanizar = (s) => {
  if (!s) return "—";
  let t = s.toLowerCase().replace(/_/g, " ");
  ACENTOS.forEach(([a, b]) => (t = t.split(a).join(b)));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const fecha = (v) => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleString("es-GT", { dateStyle: "medium", timeStyle: "short" }) : "—";
};

export const fechaDe = (x) => fecha(x.createdAt || x.fecha_movimiento || x.fecha || x.fecha_hora || x.updatedAt);
export const nombreCli = (d) => (d.Cliente ? `${d.Cliente.nombre} ${d.Cliente.apellido || ""}`.trim() : `Cliente ${d.id_cliente}`);
export const nombreEmp = (e) => (e ? `${e.nombre} ${e.apellido || ""}`.trim() : "Sistema");
export const prod = (p) => (p ? [p.nombre, p.talla, p.color].filter(Boolean).join(" ") : "—");
export const vacioANull = (v) => { const t = String(v ?? "").trim(); return t === "" ? undefined : t; };
// Observaciones guardadas como código (EN_MAYUSCULAS) se muestran legibles.
export const observacion = (o) => (/^[A-Z_]+$/.test(o) ? humanizar(o) : o);

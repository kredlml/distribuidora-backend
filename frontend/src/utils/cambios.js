/**
 * Deja en `body` solo los campos que cambiaron respecto de `original`. Así un diálogo abierto hace
 * rato no pisa lo que otro usuario modificó en otros campos (p.ej. reactivar a alguien desactivado).
 * Compara null/undefined/"" como iguales y números como números.
 */
export function soloCambios(body, original) {
  const norm = (v) => (v === undefined || v === "" ? null : v);
  return Object.fromEntries(Object.entries(body).filter(([k, v]) => {
    const a = norm(original[k]), b = norm(v);
    if (a === null || b === null) return a !== b;
    return typeof a === "number" || typeof b === "number" ? Number(a) !== Number(b) : String(a) !== String(b);
  }));
}

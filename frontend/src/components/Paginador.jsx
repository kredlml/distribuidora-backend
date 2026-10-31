/** Controles de página para las respuestas { total, pagina, paginas } del servidor. */
export default function Paginador({ datos, onPagina, nombre = "resultados" }) {
  if (!datos || datos.paginas <= 1) return null;
  const { pagina, paginas, total, por_pagina: n } = datos;
  const desde = (pagina - 1) * n + 1, hasta = Math.min(total, pagina * n);
  return (
    <nav className="bar paginador" aria-label="Páginas">
      <button className="btn mini" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}>Anterior</button>
      <span className="muted sm">{desde}–{hasta} de {total} {nombre} · página {pagina} de {paginas}</span>
      <button className="btn mini" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>Siguiente</button>
    </nav>
  );
}

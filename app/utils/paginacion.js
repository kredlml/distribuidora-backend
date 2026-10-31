// Paginación de listados del panel. Es opcional para no romper a quien pide la lista completa:
// sin ?pagina= el endpoint responde el arreglo de siempre; con ?pagina=N[&por_pagina=M] responde
// { datos, total, pagina, por_pagina, paginas }.
const { errorHttp } = require("./facturacion");

const POR_PAGINA = 25, MAX_POR_PAGINA = 100;

function leerPaginacion(query) {
  if (query.pagina === undefined || query.pagina === "") return null;
  const pagina = Number(query.pagina);
  const por_pagina = query.por_pagina === undefined || query.por_pagina === "" ? POR_PAGINA : Number(query.por_pagina);
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000) throw errorHttp(400, "pagina debe ser un número entero desde 1.");
  if (!Number.isInteger(por_pagina) || por_pagina < 1 || por_pagina > MAX_POR_PAGINA) throw errorHttp(400, `por_pagina debe estar entre 1 y ${MAX_POR_PAGINA}.`);
  return { pagina, por_pagina, offset: (pagina - 1) * por_pagina, limit: por_pagina };
}

const pagina = (datos, total, p) => ({ datos, total, pagina: p.pagina, por_pagina: p.por_pagina, paginas: Math.max(1, Math.ceil(total / p.por_pagina)) });

// Texto de búsqueda (máx. 80 caracteres) escapado para ILIKE; null si no hay.
function textoBusqueda(q) {
  const t = String(q || "").trim().slice(0, 80);
  return t ? `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
}
// Número de registro buscado como "#123" o "123".
const idBuscado = (q) => { const m = String(q || "").trim().match(/^#?(\d{1,9})$/); return m ? Number(m[1]) : null; };

module.exports = { leerPaginacion, pagina, textoBusqueda, idBuscado, POR_PAGINA, MAX_POR_PAGINA };

import { useEffect, useState } from "react";

/** Devuelve `valor` cuando deja de cambiar durante `ms` (para buscar en el servidor mientras se escribe). */
export default function useDebounced(valor, ms = 350) {
  const [quieto, setQuieto] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setQuieto(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return quieto;
}

/** Si la página pedida ya no existe (se cobró o canceló algo y la lista se acortó), salta a la última. */
export function useCorregirPagina(data, irA) {
  useEffect(() => {
    if (data && data.total > 0 && data.pagina > data.paginas) irA(data.paginas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}

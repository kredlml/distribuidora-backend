// Sesión del cliente. Clave distinta a la del panel ("sesion") por si ambos corren en el mismo dominio.
const KEY = "sesion_tienda";

export function leerSesion() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function guardarSesion(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* almacenamiento no disponible: la sesión dura lo que la pestaña */ }
}

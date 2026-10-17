const KEY = "sesion";

export function leerSesion() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function guardarSesion(s) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

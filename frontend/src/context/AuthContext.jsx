import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setUnauthorizedHandler } from "../services/api";
import * as authService from "../services/authService";
import { guardarSesion, leerSesion } from "../services/session";
import { rolDe } from "../utils/permisos";
import { useToast } from "./ToastContext";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Mezcla datos nuevos en la sesión guardada, solo si sigue siendo la misma sesión (mismo token).
function mezclar(token, datos) {
  const actual = leerSesion();
  if (!actual || actual.token !== token) return null;
  const nueva = { ...actual, ...datos };
  guardarSesion(nueva);
  return nueva;
}

export function AuthProvider({ children }) {
  const aviso = useToast();
  const [sesion, setSesion] = useState(leerSesion);

  const salir = useCallback(() => { guardarSesion(null); setSesion(null); }, []);

  const entrar = useCallback(async (email, password) => {
    const s = await authService.login(email, password);
    guardarSesion(s);
    setSesion(s);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { salir(); aviso("Tu sesión expiró o ya no es válida. Inicia sesión de nuevo.", true); });
  }, [salir, aviso]);

  const token = sesion && sesion.token;

  /** Vuelve a leer nombre, correo y puesto del servidor (p.ej. tras editar los propios datos). */
  const refrescar = useCallback(async () => {
    if (!token) return;
    const datos = await authService.yo().catch(() => null); // sin red o token inválido: lo maneja api()
    const nueva = datos && mezclar(token, { ...datos, token });
    if (nueva) setSesion(nueva);
  }, [token]);

  /** Tras cambiar la contraseña el servidor cierra las demás sesiones y entrega un token nuevo. */
  const renovarToken = useCallback((nuevoToken) => {
    const nueva = mezclar(token, { token: nuevoToken });
    if (nueva) setSesion(nueva);
  }, [token]);

  // Al abrir el panel se refrescan nombre y puesto desde el servidor: si un ADMIN cambió el
  // puesto después del login, el menú se ajusta sin tener que volver a iniciar sesión.
  useEffect(() => { refrescar(); }, [refrescar]);

  const value = useMemo(() => ({ sesion, rol: rolDe(sesion), entrar, salir, refrescar, renovarToken }), [sesion, entrar, salir, refrescar, renovarToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

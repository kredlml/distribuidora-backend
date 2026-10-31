import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setUnauthorizedHandler } from "../services/api";
import * as authService from "../services/authService";
import { guardarSesion, leerSesion } from "../services/session";
import { useToast } from "./ToastContext";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/** Sesión del cliente: { token, cliente }. */
export function AuthProvider({ children }) {
  const aviso = useToast();
  const [sesion, setSesion] = useState(leerSesion);
  // true cuando el cliente cerró sesión a propósito: las rutas privadas lo mandan al catálogo
  // en vez de al login (si expiró el token, sí se le pide iniciar sesión otra vez).
  const cierreVoluntario = useRef(false);

  const abrir = useCallback((s) => { cierreVoluntario.current = false; guardarSesion(s); setSesion(s); }, []);
  const salir = useCallback(() => { guardarSesion(null); setSesion(null); }, []);
  const cerrarSesion = useCallback(() => { cierreVoluntario.current = true; salir(); }, [salir]);
  const fueCierreVoluntario = useCallback(() => cierreVoluntario.current, []);

  const entrar = useCallback(async (email, password) => abrir(await authService.login(email, password)), [abrir]);
  const registrar = useCallback(async (datos) => abrir(await authService.registro(datos)), [abrir]);
  const activar = useCallback(async (datos) => abrir(await authService.activar(datos)), [abrir]);
  const restablecer = useCallback(async (datos) => {
    const r = await authService.restablecer(datos);
    abrir({ token: r.token, cliente: r.cliente });
  }, [abrir]);
  const actualizarCliente = useCallback((cliente) => {
    setSesion((s) => { const n = s ? { ...s, cliente } : s; guardarSesion(n); return n; });
  }, []);
  // Tras cambiar la contraseña el servidor emite un token nuevo (el anterior deja de valer).
  const renovarToken = useCallback((token) => {
    setSesion((s) => { const n = s ? { ...s, token } : s; guardarSesion(n); return n; });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { salir(); aviso("Tu sesión expiró. Inicia sesión de nuevo.", true); });
  }, [salir, aviso]);

  const value = useMemo(() => ({ sesion, cliente: sesion && sesion.cliente, entrar, registrar, activar, restablecer, salir, cerrarSesion, fueCierreVoluntario, actualizarCliente, renovarToken }),
    [sesion, entrar, registrar, activar, restablecer, salir, cerrarSesion, fueCierreVoluntario, actualizarCliente, renovarToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

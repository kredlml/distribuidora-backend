import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setUnauthorizedHandler } from "../services/api";
import * as authService from "../services/authService";
import { guardarSesion, leerSesion } from "../services/session";
import { rolDe } from "../utils/permisos";
import { useToast } from "./ToastContext";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

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
    setUnauthorizedHandler(() => { salir(); aviso("Tu sesión expiró. Inicia sesión de nuevo.", true); });
  }, [salir, aviso]);

  const value = useMemo(() => ({ sesion, rol: rolDe(sesion), entrar, salir }), [sesion, entrar, salir]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

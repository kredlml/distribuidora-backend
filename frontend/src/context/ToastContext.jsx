import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ msg: "", mal: false, show: false });
  const timer = useRef();

  const aviso = useCallback((msg, mal = false) => {
    setToast({ msg, mal, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 4500);
  }, []);

  return (
    <ToastContext.Provider value={aviso}>
      {children}
      <div id="toast" role="status" aria-live="polite" className={toast.show ? "show" + (toast.mal ? " bad" : "") : ""}>{toast.msg}</div>
    </ToastContext.Provider>
  );
}

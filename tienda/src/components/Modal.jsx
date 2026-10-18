import { useEffect, useRef } from "react";

/** Diálogo nativo <dialog>. Se monta abierto; `onClose` se llama al cerrar (Esc incluido). */
export default function Modal({ onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return <dialog ref={ref} onClose={onClose}>{children}</dialog>;
}

import { useEffect, useRef } from "react";

/** Diálogo nativo <dialog>. Se monta abierto; `onClose` se llama al cerrar (Esc incluido).
 *  className="ancho" lo hace más ancho (documentos con tablas). */
export default function Modal({ onClose, children, className }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return <dialog ref={ref} onClose={onClose} className={className}>{children}</dialog>;
}

import { CONCEPTOS } from "./constants";
import { dinero, fecha, humanizar, nombreEmp } from "./format";

const VIOLETA = [84, 51, 235];
const TINTA = [0, 0, 0];
const GRIS = [110, 110, 110];
const TITULO = { ENTRADA: "COMPROBANTE DE ENTRADA", SALIDA: "COMPROBANTE DE SALIDA" };
// Quién entrega y quién recibe la mercadería, según el documento (para las firmas).
function firmas(c) {
  const cliente = c.Pedido && c.Pedido.Cliente ? `${c.Pedido.Cliente.nombre} ${c.Pedido.Cliente.apellido || ""}`.trim() : "Cliente";
  const bodega = c.Empleado ? nombreEmp(c.Empleado) : "Bodega";
  if (c.tipo === "ENTRADA") {
    const entrega = c.Proveedor ? c.Proveedor.nombre_empresa : ["DEVOLUCION", "CAMBIO"].includes(c.concepto) ? cliente : "Entregó";
    return [["Entregó", entrega], ["Recibió en bodega", bodega]];
  }
  if (c.concepto === "BAJA") return [["Autorizó la baja", bodega], ["Verificó", ""]];
  return [["Entregó", bodega], ["Recibió", cliente]];
}

/**
 * Genera y descarga el PDF de un comprobante de entrada o salida de mercadería: encabezado con el
 * folio, datos de la operación, detalle de prendas, totales y firmas. jsPDF se carga solo al pedirlo.
 */
export async function descargarComprobantePdf(c) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const m = 40;

  // Encabezado: emisor a la izquierda, recuadro con el tipo y el folio a la derecha.
  doc.setFillColor(...VIOLETA).rect(0, 0, ancho, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...TINTA).text("Distribuidora", m, 46);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...GRIS);
  const s = c.Sucursal || {};
  const cajaAncho = 220, cajaX = ancho - m - cajaAncho;
  // Sucursal y dirección ajustadas al espacio libre a la izquierda del recuadro del folio.
  const emisor = doc.splitTextToSize(`Sucursal ${s.nombre || c.id_sucursal}`, cajaX - m - 16).slice(0, 2)
    .concat(s.direccion || s.ciudad ? doc.splitTextToSize([s.direccion, s.ciudad].filter(Boolean).join(", "), cajaX - m - 16).slice(0, 3) : []);
  doc.text(emisor, m, 62);

  doc.setDrawColor(...VIOLETA).setLineWidth(1.2).roundedRect(cajaX, 28, cajaAncho, 62, 6, 6, "S");
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...VIOLETA).text(TITULO[c.tipo], cajaX + cajaAncho / 2, 46, { align: "center" });
  doc.setFontSize(18).setTextColor(...TINTA).text(`No. ${c.folio}`, cajaX + cajaAncho / 2, 68, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...GRIS).text(fecha(c.fecha), cajaX + cajaAncho / 2, 83, { align: "center" });

  // Datos de la operación (dos columnas de etiqueta y valor).
  const datos = [["Concepto", CONCEPTOS[c.concepto] || c.concepto], ["Responsable", c.Empleado ? `${nombreEmp(c.Empleado)} (${humanizar(c.Empleado.puesto)})` : "Sistema (pago en línea)"]];
  if (c.Proveedor) datos.push(["Proveedor", c.Proveedor.nombre_empresa + (c.Proveedor.telefono ? `, tel. ${c.Proveedor.telefono}` : "")]);
  if (c.documento_proveedor) datos.push(["Factura o envío del proveedor", c.documento_proveedor]);
  if (c.Pedido) datos.push(["Pedido", `#${c.Pedido.id_pedido}${c.Pedido.Cliente ? `, ${c.Pedido.Cliente.nombre} ${c.Pedido.Cliente.apellido || ""}`.trimEnd() : ""}`]);
  if (c.Devolucion) datos.push(["Devolución", `#${c.Devolucion.id_devolucion}, ${humanizar(c.Devolucion.tipo)}`]);
  autoTable(doc, {
    startY: Math.max(108, 62 + emisor.length * 12 + 16), body: datos, theme: "plain", margin: { left: m, right: m },
    styles: { fontSize: 10, cellPadding: { top: 2, bottom: 2, left: 0, right: 8 } },
    columnStyles: { 0: { textColor: GRIS, cellWidth: 170 }, 1: { textColor: TINTA } },
  });
  let y = doc.lastAutoTable.finalY;
  if (c.motivo) {
    doc.setFontSize(10).setTextColor(...GRIS).text("Motivo u observación", m, (y += 16));
    const lineas = doc.splitTextToSize(c.motivo, ancho - m * 2);
    doc.setTextColor(...TINTA).text(lineas, m, (y += 13));
    y += (lineas.length - 1) * 12;
  }

  // Detalle de prendas. Las columnas de valor solo aparecen si alguna línea lo tiene.
  const conValor = c.lineas.some((l) => l.valor_unitario != null);
  const etiquetaValor = c.concepto === "VENTA" ? "Precio" : "Costo";
  const head = ["#", "Prenda", "Estado", "Lote", "Cantidad", ...(conValor ? [`${etiquetaValor} unit.`, "Subtotal"] : [])];
  const body = c.lineas.map((l, i) => [
    i + 1, `${l.descripcion}\nPrenda #${l.id_producto}`, humanizar(l.estado_inventario), l.lote || "—", l.cantidad,
    ...(conValor ? [l.valor_unitario != null ? dinero(l.valor_unitario) : "—", l.subtotal != null ? dinero(l.subtotal) : "—"] : []),
  ]);
  const derecha = conValor ? [4, 5, 6] : [4];
  autoTable(doc, {
    startY: y + 16, head: [head], body, margin: { left: m, right: m },
    styles: { fontSize: 9, cellPadding: 5, valign: "middle" }, headStyles: { fillColor: VIOLETA },
    alternateRowStyles: { fillColor: [247, 247, 250] },
    columnStyles: { 0: { cellWidth: 24 }, ...Object.fromEntries(derecha.map((k) => [k, { halign: "right" }])) },
    // Los encabezados de las columnas numéricas, alineados con sus cifras.
    didParseCell: (d) => { if (d.section === "head" && derecha.includes(d.column.index)) d.cell.styles.halign = "right"; },
  });
  y = doc.lastAutoTable.finalY + 18;

  // Totales
  if (y > alto - 150) { doc.addPage(); y = m + 10; }
  doc.setFontSize(10).setTextColor(...GRIS).text("Total de unidades", ancho - m - 160, y);
  doc.setFont("helvetica", "bold").setTextColor(...TINTA).text(String(c.total_unidades), ancho - m, y, { align: "right" });
  if (Number(c.descuento) > 0) {
    doc.setFont("helvetica", "normal").setTextColor(...GRIS).text("Descuento (cupón)", ancho - m - 160, (y += 16));
    doc.setTextColor(...TINTA).text(`-${dinero(c.descuento)}`, ancho - m, y, { align: "right" });
  }
  if (c.valor_total != null) {
    doc.setFont("helvetica", "normal").setTextColor(...GRIS).text(c.concepto === "VENTA" ? "Valor de la mercadería" : "Valor total", ancho - m - 160, (y += 16));
    doc.setFont("helvetica", "bold").setTextColor(...TINTA).text(dinero(c.valor_total), ancho - m, y, { align: "right" });
  }
  doc.setFont("helvetica", "normal");

  // Firmas
  y = Math.max(y + 70, alto - 120);
  const anchoFirma = (ancho - m * 2 - 40) / 2;
  firmas(c).forEach(([rol, nombre], i) => {
    const x = m + i * (anchoFirma + 40);
    doc.setDrawColor(...GRIS).setLineWidth(0.6).line(x, y, x + anchoFirma, y);
    // Nombres largos (razón social, cliente) en hasta 2 líneas dentro del ancho de su firma.
    const lineas = doc.setFontSize(9).splitTextToSize(nombre || " ", anchoFirma).slice(0, 2);
    doc.setTextColor(...TINTA).text(lineas, x, y + 13);
    doc.setTextColor(...GRIS).text(rol, x, y + 13 + lineas.length * 11 + 1);
  });

  // Pie con la nota de emisión y el número de página
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(140);
    doc.text(`${c.folio} · Documento emitido por el sistema al registrar el movimiento; no se puede modificar.`, m, alto - 20);
    doc.text(`Página ${i} de ${paginas}`, ancho - m, alto - 20, { align: "right" });
  }
  doc.save(`${c.folio}.pdf`);
}

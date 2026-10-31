import { METODOS_PAGO, ORIGENES } from "./constants";
import { dinero, fecha } from "./format";

const NOMBRE_ORIGEN = Object.fromEntries(ORIGENES);
const VIOLETA = [84, 51, 235];
const prenda = (p) => [p.nombre, p.talla, p.color].filter(Boolean).join(" ");
const diaLargo = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("es-GT", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/**
 * Genera y descarga el PDF del reporte de ventas con lo que se ve en pantalla: encabezado
 * (sucursal, periodo, quién lo generó), indicadores y las tablas del periodo.
 * jsPDF se carga solo al pedir el documento (no pesa en el resto del panel).
 */
export async function descargarReportePdf(r, { titulo }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const ancho = doc.internal.pageSize.getWidth();
  const margen = 40;
  let y = margen;

  // Encabezado
  doc.setFillColor(...VIOLETA);
  doc.rect(0, 0, ancho, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(0);
  doc.text("Reporte de ventas", margen, (y += 14));
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(90);
  doc.text(titulo, margen, (y += 18));
  const periodo = r.periodo.desde === r.periodo.hasta ? diaLargo(r.periodo.desde) : `${diaLargo(r.periodo.desde)} al ${diaLargo(r.periodo.hasta)}`;
  doc.text(`Periodo: ${periodo}`, margen, (y += 15));
  doc.text(`Generado el ${fecha(r.generado.fecha)} por ${r.generado.por} (${r.generado.puesto})`, margen, (y += 15));
  y += 12;

  // Indicadores (2 filas de 4)
  const k = r.kpis;
  const tarjetas = [
    ["Ventas del periodo", dinero(k.ventas)], ["Pedidos pagados", String(k.pedidos)], ["Ticket promedio", dinero(k.ticket_promedio)], ["Unidades vendidas", String(k.unidades)],
    ["Ventas de hoy", `${dinero(k.ventas_hoy)} (${k.pedidos_hoy})`], ["Por cobrar", `${dinero(k.pendientes_cobro.monto)} (${k.pendientes_cobro.pedidos})`],
    ["Pedidos cancelados", String(k.cancelados)], ["Devoluciones / cambios", `${k.devoluciones.devoluciones} / ${k.devoluciones.cambios}`],
    ["Reembolsado", `${dinero(k.reembolsos.monto)} (${k.reembolsos.cantidad})`], ["Ventas netas", dinero(k.ventas_netas)],
    ["Descuentos (cupones)", dinero(k.descuentos)], ["Envíos cobrados", dinero(k.envios)], [`IVA incluido (${k.iva_porcentaje}%)`, dinero(k.iva)],
  ];
  const anchoT = (ancho - margen * 2 - 3 * 8) / 4;
  tarjetas.forEach(([t, v], i) => {
    const x = margen + (i % 4) * (anchoT + 8);
    const yy = y + Math.floor(i / 4) * 52;
    doc.setFillColor(242, 244, 245).roundedRect(x, yy, anchoT, 44, 6, 6, "F");
    doc.setFontSize(8).setTextColor(110).text(t, x + 8, yy + 15);
    // Montos grandes: se achica la fuente para que no se salgan de la tarjeta.
    doc.setFontSize(12).setTextColor(0).setFont("helvetica", "bold");
    for (let f = 12; f > 7 && doc.getTextWidth(v) > anchoT - 16; f--) doc.setFontSize(f - 1);
    doc.text(v, x + 8, yy + 33);
    doc.setFont("helvetica", "normal");
  });
  y += Math.ceil(tarjetas.length / 4) * 52 + 6;

  const tabla = (tituloTabla, head, body, opciones = {}) => {
    if (!body.length) return;
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margen; }
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(0).text(tituloTabla, margen, (y += 16));
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y + 6, head: [head], body, margin: { left: margen, right: margen },
      styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: VIOLETA }, alternateRowStyles: { fillColor: [247, 247, 250] },
      ...opciones,
    });
    y = doc.lastAutoTable.finalY + 6;
  };
  const derecha = (cols) => ({ columnStyles: Object.fromEntries(cols.map((c) => [c, { halign: "right" }])) });

  if (r.por_sucursal.length > 1) {
    tabla("Ventas por sucursal", ["Sucursal", "Pedidos", "Unidades", "Ventas"],
      r.por_sucursal.map((s) => [s.nombre, s.pedidos, s.unidades, dinero(s.ventas)]), derecha([1, 2, 3]));
  }
  tabla("Ventas por día", ["Día", "Pedidos", "Ventas"], r.por_dia.map((d) => [diaLargo(d.dia), d.pedidos, dinero(d.ventas)]), derecha([1, 2]));
  tabla("Prendas vendidas", ["#", "Prenda", "Tipo", "Unidades", "Ventas"],
    r.por_prenda.map((p, i) => [i + 1, prenda(p), p.tipo || "-", p.unidades, dinero(p.ventas)]), derecha([0, 3, 4]));
  tabla("Ventas por tipo de prenda", ["Tipo", "Unidades", "Ventas"], r.por_tipo.map((t) => [t.tipo, t.unidades, dinero(t.ventas)]), derecha([1, 2]));
  tabla("Cobros por método de pago", ["Método", "Pagos", "Monto"], r.por_metodo.map((m) => [METODOS_PAGO[m.metodo] || m.metodo, m.pagos, dinero(m.monto)]), derecha([1, 2]));
  tabla("Ventas con cupón", ["Cupón", "Pedidos", "Descuento", "Ventas"], (r.por_cupon || []).map((c) => [c.codigo, c.pedidos, dinero(c.descuento), dinero(c.ventas)]), derecha([1, 2, 3]));
  tabla("Ventas por origen", ["Origen", "Pedidos", "Ventas"], r.por_origen.map((o) => [NOMBRE_ORIGEN[o.origen] || o.origen, o.pedidos, dinero(o.ventas)]), derecha([1, 2]));
  tabla("Ventas por vendedor (mostrador)", ["Vendedor", "Sucursal", "Pedidos", "Ventas"],
    r.por_vendedor.map((v) => [`${v.nombre} ${v.apellido || ""}`.trim(), v.sucursal, v.pedidos, dinero(v.ventas)]), derecha([2, 3]));
  tabla("Stock crítico (en o bajo el mínimo)", ["Prenda", "Sucursal", "Stock", "Mínimo"],
    r.stock_critico.map((s) => [prenda(s), s.sucursal, s.stock, s.stock_minimo]), derecha([2, 3]));
  if (!r.por_dia.length) {
    doc.setFontSize(11).setTextColor(110).text("No hubo ventas pagadas en este periodo.", margen, (y += 20));
  }

  // Pie con número de página
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(140).text(`Distribuidora - ${titulo} - página ${i} de ${paginas}`, margen, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(`reporte-ventas-${r.periodo.desde}${r.periodo.hasta !== r.periodo.desde ? "_" + r.periodo.hasta : ""}.pdf`);
}

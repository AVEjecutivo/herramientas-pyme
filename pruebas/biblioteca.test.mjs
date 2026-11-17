/** Pruebas de la biblioteca contra los ejemplos ficticios de ejemplos/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as m from "../src/index.js";

const ej = r => new URL("../ejemplos/" + r, import.meta.url).pathname;
const leer = (r, enc = "utf8") => readFileSync(ej(r), enc);
const ventas = m.leerRegistroSII(leer("registros/RegistroVentas_SII_ejemplo.csv")).map(f => ({ ...f, libro: "ventas" }));
const compras = m.leerRegistroSII(leer("registros/RegistroCompras_SII_ejemplo.csv")).map(f => ({ ...f, libro: "compras" }));
const movs = m.leerCartola(leer("cartolas/Cartola_BancoEstado_ejemplo.csv")).movimientos;

test("RUT: valida, normaliza y detecta duplicados", () => {
  assert.equal(m.validarRut("765432103").rut, "76.543.210-3");
  assert.equal(m.validarRut("12.345.678-9").valido, false);
  assert.equal(m.validarRut("76.980.417-k").rut, "76.980.417-K");
  assert.equal(m.depurarRuts(["76.543.210-3", "765432103"])[1].duplicado_de, 1);
});

test("montos y fechas chilenos", () => {
  assert.equal(m.leerMonto("$ 1.234.567"), 1234567);
  assert.equal(m.leerMonto("(15.000)"), -15000);
  assert.equal(m.leerFecha("15 de Julio del 2026"), "2026-07-15");
});

test("XML: EnvioDTE con factura, exenta y nota de crédito", () => {
  const r = m.leerDTE(leer("facturas/dte-envio-ejemplo.xml", "latin1"));
  assert.deepEqual(r.map(f => f.tipo_dte), ["33", "34", "61"]);
  assert.equal(r[0].monto_total, 1487500);
  assert.ok(r.every(f => f.confianza === "alta"));
});

test("PDF con texto: dos formatos de factura", async () => {
  const { facturas } = await m.leerFacturas([ej("facturas/factura-ejemplo-1.pdf"), ej("facturas/factura-ejemplo-2.pdf")], "76.543.210-3");
  assert.equal(facturas[0].folio, "2855"); assert.equal(facturas[0].fecha_emision, "2026-07-15");
  assert.equal(facturas[0].iva, 237500); assert.equal(facturas[0].monto_total, 1487500);
  assert.equal(facturas[1].monto_exento, 75000); assert.equal(facturas[1].monto_total, 574800);
  assert.ok(facturas.every(f => f.confianza === "alta" && f.libro === "ventas"));
});

test("PDF escaneado: se marca para transcribir, no se inventa", async () => {
  const { facturas } = await m.leerFacturas([ej("facturas/factura-escaneada-ejemplo.pdf")]);
  assert.equal(facturas[0].confianza, "baja"); assert.equal(facturas[0].monto_total, "");
});

test("texto transcrito por OCR con errores típicos (N* y LV.A.)", () => {
  const f = m.leerFacturaTexto("Servicios Técnicos Andes SpA R.U.T.: 76.543.210-3\nFACTURA ELECTRONICA\nN* 2857\nFecha Emision: 28 de Julio del 2026\nSEÑOR(ES): Supermercados La Colina\nR.U.T.: 76.222.918-8\nMONTO NETO $ 630.000\nLV.A. 19% $ 119.700\nTOTAL $ 749.700", "foto.jpg", "ocr");
  assert.equal(f.folio, "2857"); assert.equal(f.iva, 119700); assert.equal(f.confianza, "alta");
});

test("cartolas de tres bancos", () => {
  for (const [f, n, banco] of [["Cartola_BancoEstado_ejemplo.csv", 16, "BancoEstado"], ["Cartola_BCI_ejemplo.csv", 11, "BCI"], ["Cartola_Santander_ejemplo.csv", 13, "Santander"]]) {
    const r = m.leerCartola(leer("cartolas/" + f), f);
    assert.equal(r.movimientos.length, n); assert.equal(r.banco, banco);
  }
});

test("cuadratura, cobranza y flujo", () => {
  const c = m.conciliar(movs, [...ventas, ...compras]);
  assert.equal(c.resumen.movimientos_cruzados, 5);
  const a = m.antiguedadCobranza(m.conciliar(movs, ventas).facturas, { fechaCorte: "2026-07-08" });
  assert.equal(a.total, 34000000);
  assert.match(m.correoCobranza(a.clientes[0], a.detalle, "Finanzas").cuerpo, /N° 1039/);
  const fl = m.flujoCaja({ saldoInicial: 1000000, fechaInicio: "2026-07-09", porCobrar: ventas, porPagar: compras });
  assert.equal(fl.semanas.at(-1).saldo_final, 1000000 + fl.semanas.reduce((s, x) => s + x.cobros - x.pagos_proveedores - x.gastos_fijos, 0));
});

test("F29: nota de crédito resta y la tasa de honorarios va por año", () => {
  const xml = m.leerDTE(leer("facturas/dte-envio-ejemplo.xml", "latin1")).map(f => ({ ...f, libro: "ventas" }));
  assert.equal(m.estimarF29({ ventas: xml, compras: [], mes: "2026-06" }).iva_debito, 209000);
  assert.equal(m.calcularHonorario({ bruto: 1000000, anio: 2026 }).retencion, 152500);
  assert.equal(m.calcularHonorario({ bruto: 1000000, anio: 2025 }).retencion, 145000);
  const h = m.leerHonorarios(leer("honorarios/informe-boletas-ejemplo.csv"));
  assert.equal(h.boletas.filter(b => b.revision.startsWith("La retención")).length, 1);
});

test("radiografía, clasificador y presupuesto", () => {
  assert.equal(m.radiografia({ ventas, compras }).clientes[0].nombre, "Inmobiliaria Cumbres del Maipo");
  const cl = m.clasificar(movs);
  assert.equal(cl.filas.filter(f => f.categoria === "Sin clasificar").length, 0);
  const p = m.basePresupuesto({ ventas, gastos: m.clasificar(movs.filter(x => x.cargo)).filas });
  assert.equal(p.meses_ventas.length, 4); assert.equal(p.meses_gastos.length, 2);
});

// ── Revisión tributaria del 17-11-2026 ────────────────────────────
// Fuentes: Circular SII N° 53 de 2025 (Ley 21.755) y Circular SII N° 62 de 2020.
const fac = (tipo, neto, fecha = "2026-06-10", extra = {}) => ({ tipo_dte: tipo, folio: String(Math.round(neto)), fecha_emision: fecha, monto_neto: neto, monto_exento: 0, iva: Math.round(neto * 0.19), monto_total: Math.round(neto * 1.19), ...extra });

test("PPM: tasa de la ley por régimen, tramo y mes", () => {
  assert.deepEqual([m.tasaPPMLegal("propyme", false, "2025-07"), m.tasaPPMLegal("propyme", false, "2025-08"), m.tasaPPMLegal("propyme", true, "2026-06"),
    m.tasaPPMLegal("propyme", false, "2027-12"), m.tasaPPMLegal("propyme", false, "2028-01"), m.tasaPPMLegal("transparente", false, "2026-06"),
    m.tasaPPMLegal("transparente", true, "2026-06"), m.tasaPPMLegal("general", false, "2026-06")], [0.25, 0.125, 0.25, 0.125, 0.25, 0.2, 0.5, null]);
});

test("F29: IVA y PPM por separado; sin tasa usa la de la ley, con tasa la respeta", () => {
  const ventas = [fac("33", 10000000)];
  const ley = m.estimarF29({ ventas, compras: [], mes: "2026-06" });
  assert.equal(ley.tasa_ppm, 0.125); assert.equal(ley.ppm, 12500); assert.equal(ley.base_ppm_debe_ser, "cobrado");
  assert.equal(ley.total_estimado, ley.iva_a_pagar + ley.ppm);
  assert.equal(m.estimarF29({ ventas, compras: [], mes: "2026-06", tasaPPM: 0.25 }).ppm, 25000);
  assert.equal(m.estimarF29({ ventas, compras: [], mes: "2026-06", regimen: "general" }).ppm, 100000);
});

test("F29: en Pro Pyme la base del PPM es lo cobrado en el mes", () => {
  const ventas = [fac("33", 1000000, "2026-05-20", { folio: "501" }), fac("33", 2000000, "2026-06-05", { folio: "502" })];
  const movimientos = [{ fecha: "2026-06-03", descripcion: "Abono factura 501", referencia: "", cargo: 0, abono: 1190000, saldo: "" }];
  const r = m.estimarF29({ ventas, compras: [], mes: "2026-06", movimientos });
  assert.equal(r.base_ppm_tipo, "cobrado"); assert.equal(r.base_ppm, 1000000); assert.equal(r.ppm, 1250);
  assert.equal(m.estimarF29({ ventas, compras: [], mes: "2026-06", movimientos, regimen: "general" }).base_ppm, 2000000);
});

test("F29: las guías de despacho no suman IVA ni PPM", () => {
  const r = m.estimarF29({ ventas: [fac("33", 1000000), fac("52", 1000000)], compras: [fac("52", 500000)], mes: "2026-06" });
  assert.equal(r.iva_debito, 190000); assert.equal(r.iva_credito, 0); assert.equal(r.documentos_venta, 1);
});

test("Registro de Ventas real del SII: 'RUT Emisor Liquid. Factura' no lo vuelve de compras", () => {
  const enc = "Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total;IVA Retenido Total;IVA Retenido Parcial;IVA no retenido;IVA propio;IVA Terceros;RUT Emisor Liquid. Factura";
  const r = m.leerRegistroSII(enc + "\n1;33;Del Giro;76.222.918-8;Cliente Ficticio SpA;101;05/06/2026;05/06/2026;;;0;1000000;190000;1190000;0;0;0;0;0;\n", null, "octubre.csv");
  assert.equal(r[0].origen, "registro_ventas"); assert.equal(r[0].rut_receptor, "76.222.918-8");
});

test("Bancos: BICE y Security no se confunden con Banco de Chile", () => {
  const cab = "Fecha;Descripcion;Cargo;Abono;Saldo\n01/06/2026;Transferencia;;1000;1000\n";
  assert.equal(m.leerCartola("BANCO BICE - CHILE\n" + cab, "x.csv").banco, "BICE");
  assert.equal(m.leerCartola("Banco Security Chile\n" + cab, "x.csv").banco, "Security");
  assert.equal(m.leerCartola("Banco de Chile\n" + cab, "x.csv").banco, "Banco de Chile");
});

test("Clasificador: reglas con símbolos, palabras que empiezan donde empieza la palabra, notas de crédito que restan", () => {
  const r = m.clasificar([{ descripcion: "Pago C++ Academy", cargo: 1000 }, { descripcion: "Transferencia a Raimundo Pérez", cargo: 2000 }, { descripcion: "Mundo Telecomunicaciones", cargo: 3000 }],
    { reglas: [...m.leerReglas("c++ → Capacitación"), ...m.REGLAS_GASTO] });
  assert.equal(r.filas[0].categoria, "Capacitación"); assert.notEqual(r.filas[1].categoria, "Telecomunicaciones"); assert.equal(r.filas[2].categoria, "Telecomunicaciones");
  const nc = m.clasificar([{ tipo_dte: "33", razon_social_emisor: "Sodimac", monto_total: 100000 }, { tipo_dte: "61", razon_social_emisor: "Sodimac", monto_total: 30000 }]);
  assert.equal(nc.resumen.find(x => x.categoria === "Materiales e insumos").monto, 70000);
});

test("Cuadratura: un abono no se cruza con una nota de crédito, y un folio con símbolos no rompe", () => {
  const r = m.conciliar([{ fecha: "2026-06-05", descripcion: "Abono", referencia: "", cargo: 0, abono: 119000, saldo: "" }], [fac("61", 100000, "2026-06-01", { libro: "ventas", folio: "7" })]);
  assert.equal(r.resumen.movimientos_cruzados, 0);
  m.conciliar([{ fecha: "2026-06-05", descripcion: "Abono 12(3", referencia: "", cargo: 0, abono: 119000, saldo: "" }],
    [fac("33", 100000, "2026-06-01", { libro: "ventas", folio: "12(3" }), fac("33", 100000, "2026-06-02", { libro: "ventas", folio: "99" })]);
});

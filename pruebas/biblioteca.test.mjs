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

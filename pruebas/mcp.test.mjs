/** El servidor MCP, llamado como lo haría un agente. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ej = r => new URL("../ejemplos/" + r, import.meta.url).pathname;
let cliente;
const llamar = async (name, args) => {
  const r = await cliente.callTool({ name, arguments: args });
  return { error: r.isError, datos: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};

before(async () => {
  cliente = new Client({ name: "prueba", version: "1.0.0" });
  await cliente.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../mcp/servidor.mjs", import.meta.url).pathname] }));
});
after(() => cliente.close());

test("expone las herramientas y sus instrucciones", async () => {
  const { tools } = await cliente.listTools();
  const nombres = tools.map(t => t.name);
  for (const n of ["leer_facturas", "leer_cartola", "cuadrar_banco_facturas", "cobranza_por_antiguedad", "flujo_caja_13_semanas", "estimar_f29", "clasificar_gastos", "revisar_informe_honorarios"]) assert.ok(nombres.includes(n), n);
  assert.match(cliente.getInstructions(), /pymes chilenas/);
});

test("leer_facturas con PDF y XML, y guarda el CSV", async () => {
  const salida = join(tmpdir(), "facturas-prueba.csv");
  const { datos } = await llamar("leer_facturas", { rutas: [ej("facturas/dte-envio-ejemplo.xml"), ej("facturas/factura-ejemplo-1.pdf")], rut_empresa: "76.543.210-3", guardar_en: salida });
  assert.equal(datos.resumen.documentos, 4); assert.equal(datos.resumen.por_revisar, 0);
  assert.match(readFileSync(salida, "utf8"), /^﻿archivo;tipo_dte/);
  rmSync(salida);
});

test("cuadrar_banco_facturas", async () => {
  const { datos } = await llamar("cuadrar_banco_facturas", { cartolas: [ej("cartolas/Cartola_BancoEstado_ejemplo.csv")], facturas: [ej("registros/RegistroVentas_SII_ejemplo.csv"), ej("registros/RegistroCompras_SII_ejemplo.csv")] });
  assert.equal(datos.resumen.movimientos_cruzados, 5);
});

test("cobranza_por_antiguedad con borradores de correo", async () => {
  const { datos } = await llamar("cobranza_por_antiguedad", { ventas: [ej("registros/RegistroVentas_SII_ejemplo.csv")], cartolas: [ej("cartolas/Cartola_BancoEstado_ejemplo.csv")], fecha_corte: "2026-07-08", firma: "Finanzas" });
  assert.equal(datos.total_por_cobrar, 34000000);
  assert.ok(datos.borradores_de_correo.length >= 1);
  assert.match(datos.borradores_de_correo[0].cuerpo, /Finanzas$/);
});

test("estimar_f29 pide el RUT cuando hace falta", async () => {
  const sin = await llamar("estimar_f29", { facturas: [ej("facturas/dte-envio-ejemplo.xml")] });
  assert.match(sin.datos.aviso, /rut_empresa/);
  const con = await llamar("estimar_f29", { facturas: [ej("facturas/dte-envio-ejemplo.xml")], rut_empresa: "76.543.210-3", remanente: 50000 });
  assert.equal(con.datos.iva_a_pagar, 159000);
});

test("estimar_f29 separa IVA y PPM, toma la tasa de la ley y usa la cartola para la base cobrada", async () => {
  const facturas = [ej("registros/RegistroVentas_SII_ejemplo.csv"), ej("registros/RegistroCompras_SII_ejemplo.csv")];
  const sin = await llamar("estimar_f29", { facturas, mes: "2026-06" });
  assert.equal(sin.datos.tasa_ppm, 0.125); assert.equal(sin.datos.base_ppm_tipo, "facturado"); assert.match(sin.datos.aviso_base_ppm, /cartola/);
  const con = await llamar("estimar_f29", { facturas, mes: "2026-06", cartolas: [ej("cartolas/Cartola_BancoEstado_ejemplo.csv")] });
  assert.equal(con.datos.base_ppm_tipo, "cobrado"); assert.equal(con.datos.aviso_base_ppm, undefined);
  assert.equal(con.datos.total_estimado, con.datos.iva_a_pagar + con.datos.ppm);
  const t = await llamar("estimar_f29", { facturas, mes: "2026-06", regimen: "transparente" });
  assert.equal(t.datos.tasa_ppm, 0.2);
});

test("estimar_f29 con una cartola que no llega al mes usa lo facturado y lo dice", async () => {
  const facturas = [ej("registros/RegistroVentas_SII_ejemplo.csv"), ej("registros/RegistroCompras_SII_ejemplo.csv")];
  const r = await llamar("estimar_f29", { facturas, mes: "2026-04", cartolas: [ej("cartolas/Cartola_BancoEstado_ejemplo.csv")] });
  assert.equal(r.datos.base_ppm_tipo, "facturado"); assert.ok(r.datos.ppm > 0, "no $0");
  assert.ok(r.datos.cartola_no_cubre); assert.match(r.datos.aviso_base_ppm, /no llega a 2026-04/);
});

test("flujo_caja_13_semanas y errores claros", async () => {
  const { datos } = await llamar("flujo_caja_13_semanas", { facturas: [ej("registros/RegistroVentas_SII_ejemplo.csv"), ej("registros/RegistroCompras_SII_ejemplo.csv")], saldo_inicial: 2450000, fecha_inicio: "2026-07-09", gastos_fijos: [{ concepto: "Arriendo", monto: 850000, dia: 26 }] });
  assert.equal(datos.semanas.length, 13);
  const e = await llamar("calcular_honorario", { anio: 2026 });
  assert.equal(e.error, true);
});

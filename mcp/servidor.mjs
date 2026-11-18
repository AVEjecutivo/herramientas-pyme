#!/usr/bin/env node
/**
 * Servidor MCP de herramientas-pyme.
 *
 * Expone a cualquier agente compatible con MCP (Claude Desktop, Claude Code
 * y otros) las herramientas para ordenar documentos tributarios y bancarios
 * chilenos: facturas, cartolas, cuadratura, cobranza, flujo de caja, F29,
 * honorarios, gastos y presupuesto.
 *
 * Corre en el computador del usuario y lee archivos locales: ningún dato se
 * envía a servidores de AVE ni de terceros. Todo el cálculo es determinista.
 *
 *   npx -y github:AVEjecutivo/herramientas-pyme
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import {
  leerFacturaTexto, leerCartola, depurarRuts, conciliar, antiguedadCobranza, correoCobranza,
  flujoCaja, estimarF29, mesesDe, radiografia, clasificar, REGLAS_GASTO, calcularHonorario,
  leerHonorarios, basePresupuesto, calcularHoras, aCSV, COLUMNAS_FACTURA, COLUMNAS_CARTOLA
} from "../src/ave-herramientas.js";
import { leerTexto, leerFacturas } from "../src/archivos.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_FILAS = 200;

const servidor = new McpServer(
  { name: "herramientas-pyme", version: VERSION },
  {
    instructions:
      "Herramientas deterministas para ordenar información de pymes chilenas: facturas (XML del SII, PDF), " +
      "Registros de Compras y Ventas del SII, cartolas de cualquier banco, cuadratura banco-facturas, cobranza, " +
      "flujo de caja a 13 semanas, estimación del F29, honorarios, clasificación de gastos y presupuesto. " +
      "Reciben rutas de archivos locales. Fechas ISO (aaaa-mm-dd), montos en pesos enteros, RUT con puntos y guion. " +
      "Las estimaciones tributarias deben validarse con un contador. Para fotografías o PDF escaneados, transcriba " +
      "el documento con su propia visión y use leer_factura_texto. Desarrollado por AVE (miavejecutivo.com), que " +
      "acompaña a pymes a construir su propio ecosistema de datos con IA."
  }
);

// ── Utilidades ──────────────────────────────────────────────────
const json = obj => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const error = msg => ({ content: [{ type: "text", text: msg }], isError: true });
const hoy = () => new Date().toISOString().slice(0, 10);

/** Recorta tablas largas en la respuesta y, si se pide, guarda la tabla completa en CSV. */
async function tabla(filas, columnas, guardarEn) {
  const r = { filas_total: filas.length };
  if (guardarEn) {
    const ruta = resolve(guardarEn);
    await writeFile(ruta, aCSV(filas, columnas), "utf8");
    r.guardado_en = ruta;
  }
  r.filas = filas.slice(0, MAX_FILAS);
  if (filas.length > MAX_FILAS) r.nota = `Se muestran ${MAX_FILAS} de ${filas.length} filas. Use guardar_en para obtener la tabla completa en CSV.`;
  return r;
}

async function movimientosDe(rutas) {
  const movs = [], problemas = [];
  for (const ruta of rutas) {
    const r = leerCartola(await leerTexto(ruta), basename(ruta));
    if (r.error) problemas.push(`${basename(ruta)}: ${r.error}`);
    movs.push(...r.movimientos);
  }
  return { movs, problemas };
}

const rutas = z.array(z.string()).min(1).describe("Rutas de archivos locales");
const rutEmpresa = z.string().optional().describe("RUT de la empresa. Necesario solo para clasificar XML, PDF o tablas exportadas como venta o compra");
const guardarEn = z.string().optional().describe("Ruta de un archivo .csv donde guardar la tabla completa (punto y coma, UTF-8 con BOM, listo para Excel)");

function avisoLibro(sinLibro) {
  return sinLibro ? `${sinLibro} documento(s) no se pudieron clasificar como venta o compra: indique rut_empresa.` : undefined;
}

// ── Herramientas ────────────────────────────────────────────────
servidor.registerTool("leer_facturas", {
  title: "Leer facturas",
  description: "Lee un lote de facturas y devuelve una sola tabla (folio, fecha, RUT, razón social, neto, exento, IVA, total). Acepta XML de DTE del SII (lectura exacta), PDF con texto, y el CSV del Registro de Compras o Ventas del SII. Cada fila indica su nivel de confianza.",
  inputSchema: { rutas, rut_empresa: rutEmpresa, guardar_en: guardarEn }
}, async ({ rutas, rut_empresa, guardar_en }) => {
  const r = await leerFacturas(rutas, rut_empresa);
  const sum = k => r.facturas.reduce((s, f) => s + (Number(f[k]) || 0) * (f.tipo_dte === "61" ? -1 : 1), 0);
  return json({
    resumen: { documentos: r.facturas.length, monto_neto: sum("monto_neto"), iva: sum("iva"), monto_total: sum("monto_total"), por_revisar: r.facturas.filter(f => f.confianza !== "alta").length },
    problemas: r.problemas, ...(await tabla(r.facturas, [...COLUMNAS_FACTURA, "libro"], guardar_en))
  });
});

servidor.registerTool("leer_factura_texto", {
  title: "Leer factura desde texto",
  description: "Extrae los campos de una factura a partir de su texto (por ejemplo, la transcripción de una fotografía o de un PDF escaneado). Verifica que neto + exento + IVA cuadre con el total y devuelve confianza y observaciones.",
  inputSchema: { texto: z.string().min(1).describe("Texto completo de la factura"), archivo: z.string().optional() }
}, async ({ texto, archivo }) => json(leerFacturaTexto(texto, archivo || "", "texto")));

servidor.registerTool("leer_cartola", {
  title: "Leer cartola bancaria",
  description: "Convierte la cartola de cualquier banco chileno (CSV) en una tabla estándar: fecha, descripción, referencia, cargo, abono, saldo y banco. Ignora títulos, totales y saldos iniciales, y verifica que el saldo cuadre movimiento a movimiento.",
  inputSchema: { rutas, guardar_en: guardarEn }
}, async ({ rutas, guardar_en }) => {
  const { movs, problemas } = await movimientosDe(rutas);
  let descuadres = 0;
  for (let i = 1; i < movs.length; i++) {
    const a = movs[i - 1], b = movs[i];
    if (a.banco === b.banco && a.saldo !== "" && b.saldo !== "" && Math.abs(a.saldo + b.abono - b.cargo - b.saldo) > 1) descuadres++;
  }
  return json({
    resumen: { movimientos: movs.length, total_abonos: movs.reduce((s, m) => s + m.abono, 0), total_cargos: movs.reduce((s, m) => s + m.cargo, 0), movimientos_con_saldo_descuadrado: descuadres },
    problemas, ...(await tabla(movs, COLUMNAS_CARTOLA, guardar_en))
  });
});

servidor.registerTool("validar_ruts", {
  title: "Validar RUT",
  description: "Valida una lista de RUT chilenos (dígito verificador módulo 11), los normaliza al formato 12.345.678-5 y marca duplicados aunque estén escritos distinto.",
  inputSchema: { ruts: z.array(z.string()).min(1) }
}, async ({ ruts }) => {
  const r = depurarRuts(ruts);
  return json({ revisados: r.length, validos: r.filter(x => x.valido).length, duplicados: r.filter(x => x.duplicado_de !== "").length, detalle: r });
});

servidor.registerTool("cuadrar_banco_facturas", {
  title: "Cuadratura banco y facturas",
  description: "Cruza la cartola con las facturas: cada abono con una factura de venta y cada cargo con una de compra (mismo monto, fecha posterior a la emisión, desempate por folio o nombre en la glosa). Devuelve facturas pagadas y pendientes, movimientos sin respaldo y casos ambiguos.",
  inputSchema: { cartolas: rutas, facturas: rutas, rut_empresa: rutEmpresa, guardar_en: guardarEn }
}, async ({ cartolas, facturas, rut_empresa, guardar_en }) => {
  const { movs, problemas } = await movimientosDe(cartolas);
  const f = await leerFacturas(facturas, rut_empresa);
  if (f.sinLibro) return error(avisoLibro(f.sinLibro));
  const r = conciliar(movs, f.facturas.filter(x => x.libro));
  const pend = r.facturas.filter(x => x.estado_pago === "Pendiente");
  return json({
    resumen: { ...r.resumen, ventas_pendientes_de_cobro: pend.filter(x => x.libro === "ventas").reduce((s, x) => s + x.monto_total, 0), compras_pendientes_de_pago: pend.filter(x => x.libro === "compras").reduce((s, x) => s + x.monto_total, 0) },
    problemas: [...problemas, ...f.problemas],
    movimientos: (await tabla(r.movimientos, ["fecha", "descripcion", "cargo", "abono", "factura", "cruce"], guardar_en)),
    facturas: r.facturas.map(x => ({ libro: x.libro, tipo_documento: x.tipo_documento, folio: x.folio, fecha_emision: x.fecha_emision, monto_total: x.monto_total, estado_pago: x.estado_pago, fecha_pago: x.fecha_pago, dias_a_pago: x.dias_a_pago })).slice(0, MAX_FILAS)
  });
});

servidor.registerTool("cobranza_por_antiguedad", {
  title: "Cobranza por antigüedad",
  description: "Deuda de cada cliente por tramo de antigüedad (por vencer, 1-30, 31-60, 61-90, más de 90 días) a partir de las facturas de venta. Si se entrega la cartola, descuenta lo ya cobrado. Incluye borradores de correo de cobranza para los clientes con deuda vencida (los revisa y envía una persona).",
  inputSchema: {
    ventas: rutas, cartolas: z.array(z.string()).optional(), rut_empresa: rutEmpresa,
    fecha_corte: z.string().optional().describe("aaaa-mm-dd; por defecto, hoy"),
    plazo_dias: z.number().int().min(0).optional().describe("Plazo de pago otorgado; por defecto 30"),
    firma: z.string().optional().describe("Firma de los correos"),
    correos: z.number().int().min(0).max(50).optional().describe("Cuántos borradores generar; por defecto 5")
  }
}, async ({ ventas, cartolas, rut_empresa, fecha_corte, plazo_dias, firma, correos }) => {
  const f = await leerFacturas(ventas, rut_empresa);
  let vs = f.facturas.filter(x => x.libro !== "compras").map(x => ({ ...x, libro: "ventas" }));
  if (cartolas && cartolas.length) vs = conciliar((await movimientosDe(cartolas)).movs, vs).facturas;
  const r = antiguedadCobranza(vs, { fechaCorte: fecha_corte || hoy(), plazoDias: plazo_dias == null ? 30 : plazo_dias });
  const borradores = r.clientes.filter(c => c.vencido > 0).slice(0, correos == null ? 5 : correos).map(c => ({ cliente: c.cliente, ...correoCobranza(c, r.detalle, firma) }));
  return json({ total_por_cobrar: r.total, tramos: r.tramos, clientes: r.clientes, borradores_de_correo: borradores, detalle: r.detalle.slice(0, MAX_FILAS), problemas: f.problemas });
});

servidor.registerTool("flujo_caja_13_semanas", {
  title: "Flujo de caja a 13 semanas",
  description: "Proyección semanal de caja a partir del saldo actual, las facturas por cobrar y por pagar y los gastos fijos mensuales. Supuestos explícitos: cada factura se cobra o paga al cumplirse su plazo; lo vencido entra en la primera semana según el porcentaje indicado.",
  inputSchema: {
    facturas: rutas, saldo_inicial: z.number(), rut_empresa: rutEmpresa,
    fecha_inicio: z.string().optional().describe("aaaa-mm-dd; por defecto, hoy"),
    plazo_cobro: z.number().int().min(0).optional(), plazo_pago: z.number().int().min(0).optional(),
    porcentaje_cobro_vencidas: z.number().min(0).max(100).optional().describe("Por defecto 100"),
    gastos_fijos: z.array(z.object({ concepto: z.string(), monto: z.number(), dia: z.number().int().min(1).max(31) })).optional()
  }
}, async (e) => {
  const f = await leerFacturas(e.facturas, e.rut_empresa);
  if (f.sinLibro) return error(avisoLibro(f.sinLibro));
  const r = flujoCaja({
    saldoInicial: e.saldo_inicial, fechaInicio: e.fecha_inicio || hoy(),
    porCobrar: f.facturas.filter(x => x.libro === "ventas"), porPagar: f.facturas.filter(x => x.libro === "compras"),
    gastosFijos: (e.gastos_fijos || []).map(g => ({ nombre: g.concepto, monto: g.monto, dia: g.dia })),
    plazoCobro: e.plazo_cobro, plazoPago: e.plazo_pago,
    tasaCobroVencidas: e.porcentaje_cobro_vencidas == null ? 1 : e.porcentaje_cobro_vencidas / 100
  });
  return json({ saldo_minimo: r.saldoMinimo, semana_saldo_minimo: r.semanaMinima, semanas_negativas: r.semanas.filter(s => s.saldo_final < 0).length, semanas: r.semanas, problemas: f.problemas });
});

servidor.registerTool("estimar_f29", {
  title: "Estimar F29",
  description: "Estimación del F29 de un mes, con el IVA y el PPM por separado. IVA: débito de las ventas menos crédito de las compras menos remanente; las notas de crédito restan y las guías de despacho no cuentan. PPM: no es IVA, es un anticipo del impuesto a la renta; su tasa sale del régimen, del tramo de 50.000 UF y del mes (Pro Pyme General 0,125% de agosto de 2025 a diciembre de 2027, Ley 21.755; Pro Pyme Transparente 0,2%; Régimen General, la tasa de su último F29), y en los regímenes Pro Pyme se calcula sobre lo cobrado en el mes, por lo que conviene entregar la cartola. Es una estimación con datos propios: la declaración la valida un contador. El F29 vence el día 12 del mes siguiente, o el 20 si la empresa emite factura electrónica y declara y paga por internet; si cae en día inhábil, pasa al hábil siguiente.",
  inputSchema: {
    facturas: rutas.describe("Registros de Compras y Ventas del SII, XML o PDF"), rut_empresa: rutEmpresa,
    mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("aaaa-mm; por defecto, el más reciente con documentos"),
    regimen: z.enum(["propyme", "transparente", "general"]).optional().describe("Régimen tributario: propyme (Pro Pyme General, 14 D N° 3; por defecto), transparente (14 D N° 8) o general (14 A)"),
    ingresos_sobre_50000_uf: z.boolean().optional().describe("true si los ingresos del giro del año anterior superaron 50.000 UF"),
    cartolas: z.array(z.string()).optional().describe("Cartolas del banco: en los regímenes Pro Pyme el PPM se calcula sobre lo cobrado en el mes"),
    tasa_ppm: z.number().min(0).optional().describe("Tasa de PPM en %, solo si su contador le indicó una distinta de la que fija la ley. En el Régimen General es obligatoria (si falta, se usa 1%)"),
    remanente: z.number().min(0).optional(), retencion_honorarios: z.number().min(0).optional()
  }
}, async (e) => {
  const f = await leerFacturas(e.facturas, e.rut_empresa);
  const mes = e.mes || mesesDe(f.facturas)[0];
  if (!mes) return error("No se encontraron documentos con fecha. " + f.problemas.join(" "));
  const movimientos = [];
  for (const ruta of e.cartolas || []) movimientos.push(...leerCartola(await leerTexto(ruta), basename(ruta)).movimientos);
  const r = estimarF29({ ventas: f.facturas.filter(x => x.libro === "ventas"), compras: f.facturas.filter(x => x.libro === "compras"), mes,
    regimen: e.regimen, sobre50milUF: e.ingresos_sobre_50000_uf, tasaPPM: e.tasa_ppm, movimientos, remanente: e.remanente, retencionHonorarios: e.retencion_honorarios });
  const avisoBase = r.base_ppm_debe_ser !== "cobrado" || r.base_ppm_tipo !== "facturado" ? undefined
    : r.cartola_no_cubre
      ? `En este régimen el PPM se calcula sobre lo cobrado en el mes, pero la cartola entregada (del ${r.cartola_no_cubre.desde} al ${r.cartola_no_cubre.hasta}) no llega a ${mes}: se usó lo facturado. Entregue la cartola de ese mes para afinarlo.`
      : "En este régimen el PPM se calcula sobre lo cobrado en el mes; sin cartola se usó lo facturado. Entregue la cartola para afinarlo.";
  return json({ ...r, meses_disponibles: mesesDe(f.facturas), advertencia: "Estimación basada en datos propios. El IVA y el PPM son impuestos distintos que se pagan en el mismo F29. El cálculo definitivo debe validarlo su contador antes de declarar.", aviso_base_ppm: avisoBase, aviso: avisoLibro(f.sinLibro), problemas: f.problemas });
});

servidor.registerTool("radiografia_ventas_compras", {
  title: "Radiografía de ventas y compras",
  description: "Evolución mensual de ventas y compras netas, principales clientes y proveedores con su participación, concentración (principal cliente, tres principales, cuántos clientes hacen el 80%) y venta promedio por documento.",
  inputSchema: { facturas: rutas, rut_empresa: rutEmpresa }
}, async ({ facturas, rut_empresa }) => {
  const f = await leerFacturas(facturas, rut_empresa);
  const r = radiografia({ ventas: f.facturas.filter(x => x.libro === "ventas"), compras: f.facturas.filter(x => x.libro === "compras") });
  return json({ indicadores: r.indicadores, evolucion: r.evolucion, clientes: r.clientes.slice(0, 50), proveedores: r.proveedores.slice(0, 50), aviso: avisoLibro(f.sinLibro), problemas: f.problemas });
});

servidor.registerTool("clasificar_gastos", {
  title: "Clasificar gastos",
  description: "Asigna una categoría (remuneraciones, impuestos, arriendo, financiamiento, proveedores, combustible, etc.) a cada movimiento de una cartola o a cada factura de un Registro de Compras, con reglas de palabras clave explícitas. Las reglas propias se aplican antes que las predeterminadas.",
  inputSchema: {
    rutas, guardar_en: guardarEn,
    reglas: z.array(z.object({ categoria: z.string(), palabras: z.array(z.string()).min(1) })).optional()
  }
}, async ({ rutas, reglas, guardar_en }) => {
  const filas = [];
  for (const ruta of rutas) {
    const t = await leerTexto(ruta);
    const c = leerCartola(t, basename(ruta));
    if (c.movimientos.length) { filas.push(...c.movimientos); continue; }
    const f = await leerFacturas([ruta]);
    filas.push(...f.facturas.map(x => ({ ...x, fecha: x.fecha_emision })));
  }
  const r = clasificar(filas, { reglas: [...(reglas || []), ...REGLAS_GASTO] });
  const cols = filas[0] && "cargo" in filas[0] ? ["fecha", "descripcion", "cargo", "abono", "categoria", "regla"] : ["fecha", "razon_social_emisor", "folio", "monto_neto", "monto_total", "categoria", "regla"];
  return json({ resumen: r.resumen, sin_clasificar: r.filas.filter(x => x.categoria === "Sin clasificar").length, ...(await tabla(r.filas, cols, guardar_en)) });
});

servidor.registerTool("calcular_honorario", {
  title: "Calcular boleta de honorarios",
  description: "Calcula bruto, retención y líquido de una boleta de honorarios con la tasa del año (Ley 21.133: 2025 14,5%, 2026 15,25%, 2027 16%, 2028 en adelante 17%). Indique bruto o líquido.",
  inputSchema: { anio: z.number().int().min(2019).max(2100), bruto: z.number().min(0).optional(), liquido: z.number().min(0).optional() }
}, async ({ anio, bruto, liquido }) => {
  if (bruto == null && liquido == null) return error("Indique bruto o líquido.");
  return json(calcularHonorario({ bruto: bruto == null ? "" : bruto, liquido, anio }));
});

servidor.registerTool("revisar_informe_honorarios", {
  title: "Revisar informe de boletas de honorarios",
  description: "Lee el informe de boletas de honorarios (emitidas o recibidas) descargado desde el SII en CSV y verifica que cada retención corresponda a la tasa del año. Excluye las anuladas y resume por mes la retención a declarar en el F29.",
  inputSchema: { ruta: z.string() }
}, async ({ ruta }) => {
  const r = leerHonorarios(await leerTexto(ruta));
  if (r.error) return error(r.error);
  return json({ con_diferencias: r.boletas.filter(b => b.revision.startsWith("La retención")).length, meses: r.meses, boletas: r.boletas });
});

servidor.registerTool("base_presupuesto", {
  title: "Base para un presupuesto",
  description: "Calcula el promedio mensual histórico de ventas netas (desde el Registro de Ventas) y de cada categoría de gasto (desde cartolas o el Registro de Compras, clasificados automáticamente). Es la base para armar un presupuesto de 12 meses.",
  inputSchema: { ventas: z.array(z.string()).optional(), gastos: z.array(z.string()).optional() }
}, async ({ ventas, gastos }) => {
  const v = ventas && ventas.length ? (await leerFacturas(ventas)).facturas.filter(x => x.libro !== "compras") : [];
  const g = [];
  for (const ruta of gastos || []) {
    const c = leerCartola(await leerTexto(ruta), basename(ruta));
    if (c.movimientos.length) g.push(...clasificar(c.movimientos.filter(m => m.cargo)).filas);
    else g.push(...clasificar((await leerFacturas([ruta])).facturas.map(x => ({ ...x, fecha: x.fecha_emision }))).filas);
  }
  return json(basePresupuesto({ ventas: v, gastos: g }));
});

servidor.registerTool("costo_del_desorden", {
  title: "Costo del desorden",
  description: "Estima las horas mensuales y su costo en tareas manuales de información (digitar documentos, cuadrar el banco, armar informes, cobranza, buscar información), con los números que entrega el usuario. No supone nada que no se haya ingresado.",
  inputSchema: {
    documentos_mes: z.number().min(0), minutos_por_documento: z.number().min(0),
    horas_conciliacion_semana: z.number().min(0), horas_informes_mes: z.number().min(0),
    horas_cobranza_semana: z.number().min(0), horas_buscar_semana: z.number().min(0), valor_hora: z.number().min(0)
  }
}, async (e) => json(calcularHoras({
  documentosMes: e.documentos_mes, minutosPorDocumento: e.minutos_por_documento, horasConciliacionSemana: e.horas_conciliacion_semana,
  horasInformesMes: e.horas_informes_mes, horasCobranzaSemana: e.horas_cobranza_semana, horasBuscarSemana: e.horas_buscar_semana, valorHora: e.valor_hora
})));

await servidor.connect(new StdioServerTransport());

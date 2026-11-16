/**
 * respuestas.js — las respuestas a las preguntas del dueño, calculadas desde
 * la sesión de documentos. Las usan el Panorama y cada herramienta, para que
 * el número del resumen sea exactamente el mismo que el del detalle.
 *
 * Son funciones puras: reciben `d` (lo que devuelve datos() de sesion.js) y
 * opciones, y delegan el cálculo en ave-herramientas.js. Sin DOM.
 *
 * Ajustes compartidos (d.ajustes, se guardan con guardarAjustes de sesion.js):
 *   saldo         número   saldo en banco hoy; si falta, el último de la cartola
 *   fijos         [{nombre, monto, dia}]   pagos mensuales sin factura
 *   plazoCobro    días     plazo que se da a los clientes (30)
 *   plazoPago     días     plazo que dan los proveedores (30)
 *   tasaVencidas  0 a 100  % de lo ya vencido que se espera cobrar (100)
 *   ppm           %        tasa de PPM (0,25)
 */
import { conciliar, antiguedadCobranza, flujoCaja, estimarF29, mesesDe, radiografia, clasificar, REGLAS_GASTO } from "./ave-herramientas.js";
import { cuentasDeCartola } from "./sesion.js";

const hoyISO = () => { const x = new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Los valores por defecto de cada ajuste, dados los documentos cargados. */
export function porDefecto(d) {
  const a = d.ajustes || {};
  const cuentas = cuentasDeCartola(d.movimientos);
  const saldoCartola = cuentas.length ? cuentas.reduce((t, c) => t + c.saldo, 0) : null;
  return {
    cuentas,
    hoy: d.fechaRef || hoyISO(),
    saldo: a.saldo != null ? a.saldo : saldoCartola != null ? saldoCartola : 0,
    saldoDeCartola: a.saldo == null && saldoCartola != null,
    fijos: a.fijos || [],
    plazoCobro: a.plazoCobro != null ? a.plazoCobro : 30,
    plazoPago: a.plazoPago != null ? a.plazoPago : 30,
    tasaVencidas: a.tasaVencidas != null ? a.tasaVencidas : 100,
    ppm: a.ppm != null ? a.ppm : 0.25
  };
}

// Una entrada por cada `d`: datos() crea un objeto nuevo cada vez que cambia la
// sesión, así que el resultado nunca sobrevive a un cambio de archivos.
const cache = new WeakMap();
/**
 * Banco contra facturas (ventas y compras). Si no hay cartola, las facturas
 * vuelven tal cual, todas pendientes.
 *
 * Además dice qué período cubre la cartola. Una factura pendiente emitida
 * antes del primer movimiento de la cartola pudo pagarse antes de ese día:
 * con estos documentos no se puede saber. Se informa aparte (`sinVerificar`)
 * para que quien muestre el número lo diga, en vez de darlo por deuda cierta.
 */
export function cuadrar(d) {
  if (cache.has(d)) return cache.get(d);
  const facturas = [...d.ventas, ...d.compras];
  const r = d.tiene.cartola ? conciliar(d.movimientos, facturas) : { facturas: facturas.map(f => ({ ...f, estado_pago: f.estado_pago || "Pendiente" })), movimientos: [], resumen: null };
  const pend = r.facturas.filter(f => f.estado_pago !== "Pagada");
  const signo = f => (f.tipo_dte === "61" ? -1 : 1) * (Number(f.monto_total) || 0);
  const fechas = d.movimientos.map(m => m.fecha).filter(Boolean).sort();
  const cartolaDesde = fechas[0] || "", cartolaHasta = fechas.at(-1) || "";
  const antes = libro => { const fs = cartolaDesde ? pend.filter(f => f.libro === libro && f.fecha_emision && f.fecha_emision < cartolaDesde) : []; return { n: fs.length, monto: fs.reduce((s, f) => s + signo(f), 0), desde: fs.reduce((m, f) => !m || f.fecha_emision < m ? f.fecha_emision : m, "") }; };
  const valor = {
    ...r,
    ventas: r.facturas.filter(f => f.libro === "ventas"), compras: r.facturas.filter(f => f.libro === "compras"),
    porCobrar: pend.filter(f => f.libro === "ventas").reduce((s, f) => s + signo(f), 0),
    porPagar: pend.filter(f => f.libro === "compras").reduce((s, f) => s + signo(f), 0),
    pagadasVenta: r.facturas.filter(f => f.libro === "ventas" && f.estado_pago === "Pagada").length,
    pagadasCompra: r.facturas.filter(f => f.libro === "compras" && f.estado_pago === "Pagada").length,
    cartolaDesde, cartolaHasta, sinVerificarVenta: antes("ventas"), sinVerificarCompra: antes("compras")
  };
  cache.set(d, valor);
  return valor;
}

/** ¿Quién me debe? */
export function calcCobranza(d, op) {
  op = op || {};
  const def = porDefecto(d), c = cuadrar(d);
  const corte = op.corte || def.hoy, plazo = op.plazo != null ? op.plazo : def.plazoCobro;
  const res = antiguedadCobranza(c.ventas, { fechaCorte: corte, plazoDias: plazo });
  // Días entre el último movimiento de la cartola y el día de cálculo: lo pagado después no está descontado.
  const dias = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
  const cartolaAtraso = d.tiene.cartola && c.cartolaHasta ? dias(c.cartolaHasta, corte) : 0;
  return { ...res, corte, plazo, cartolaHasta: c.cartolaHasta, cartolaDesactualizada: cartolaAtraso > 7, vencido: res.clientes.reduce((s, x) => s + x.vencido, 0), peor: res.clientes.find(x => x.mayor_atraso > 0) || null, pagadas: c.pagadasVenta, conCartola: d.tiene.cartola, cartolaDesde: c.cartolaDesde, sinVerificar: c.sinVerificarVenta };
}

/** ¿Cuánta plata voy a tener? */
export function calcCaja(d, op) {
  op = op || {};
  const def = porDefecto(d), c = cuadrar(d);
  const e = {
    saldoInicial: op.saldo != null ? op.saldo : def.saldo, fechaInicio: op.inicio || def.hoy,
    porCobrar: c.ventas, porPagar: c.compras, gastosFijos: (op.fijos || def.fijos).filter(g => Number(g.monto) > 0),
    plazoCobro: op.plazoCobro != null ? op.plazoCobro : def.plazoCobro, plazoPago: op.plazoPago != null ? op.plazoPago : def.plazoPago,
    tasaCobroVencidas: (op.tasaVencidas != null ? op.tasaVencidas : def.tasaVencidas) / 100
  };
  const res = flujoCaja(e);
  return { ...res, entrada: e, negativas: res.semanas.filter(s => s.saldo_final < 0).length, sinFijos: !e.gastosFijos.length, saldoDeCartola: op.saldo == null && def.saldoDeCartola, conCartola: d.tiene.cartola,
    // Para decir de cuándo es el saldo y qué falta: nadie debe leer "caja en rojo" por un saldo que no escribió.
    saldoFecha: c.cartolaHasta, sinSaldo: op.saldo == null && !def.saldoDeCartola && d.ajustes.saldo == null,
    faltaVentas: !d.tiene.ventas, faltaCompras: !d.tiene.compras,
    cartolaDesde: c.cartolaDesde, sinVerificarVenta: c.sinVerificarVenta, sinVerificarCompra: c.sinVerificarCompra };
}

/** ¿Cuánto voy a pagar de IVA? `mes` aaaa-mm; por defecto, el más reciente con ventas y compras. */
export function calcF29(d, op) {
  op = op || {};
  const meses = mesesDe([...d.ventas, ...d.compras]);
  if (!meses.length) return null;
  // Por defecto, el mes más reciente que tenga ventas y compras: el último mes
  // suele estar a medias (solo compras, o solo ventas) y daría un IVA engañoso.
  const conAmbos = meses.filter(m => d.ventas.some(f => (f.fecha_emision || "").startsWith(m)) && d.compras.some(f => (f.fecha_emision || "").startsWith(m)));
  const mes = op.mes && meses.includes(op.mes) ? op.mes : (conAmbos[0] || meses[0]);
  const res = estimarF29({ ventas: d.ventas, compras: d.compras, mes, tasaPPM: op.ppm != null ? op.ppm : porDefecto(d).ppm, remanente: op.remanente || 0, retencionHonorarios: op.honorarios || 0 });
  return { ...res, meses, faltaVentas: !d.tiene.ventas, faltaCompras: !d.tiene.compras };
}

/** ¿En qué se va la plata? `fuente`: "cartola" (por defecto si existe) o "compras". */
export function calcGastos(d, op) {
  op = op || {};
  const fuente = op.fuente && d.tiene[op.fuente] ? op.fuente : d.tiene.cartola ? "cartola" : d.tiene.compras ? "compras" : "";
  if (!fuente) return null;
  const base = fuente === "cartola" ? d.movimientos : d.compras.map(f => ({ ...f, fecha: f.fecha_emision }));
  const res = clasificar(base, { reglas: [...(op.reglas || []), ...REGLAS_GASTO] });
  const gastos = res.resumen.filter(r => r.categoria !== "Ingresos");
  return { ...res, fuente, gastos, total: gastos.reduce((s, r) => s + r.monto, 0), sinClasificar: res.filas.filter(f => f.categoria === "Sin clasificar").length };
}

/** ¿De quién dependo? */
export function calcRadiografia(d) {
  if (!d.tiene.ventas && !d.tiene.compras) return null;
  return radiografia({ ventas: d.ventas, compras: d.compras });
}

/**
 * sesion.js — los documentos del usuario, compartidos entre las herramientas.
 *
 * El problema que resuelve: antes cada herramienta pedía de nuevo los mismos
 * archivos. Ahora lo que se lee una vez queda disponible para todas, de modo
 * que el dueño sube su Registro de Ventas, el de Compras y la cartola una sola
 * vez y recorre las respuestas.
 *
 * Dónde vive: en `sessionStorage`, es decir, dentro del navegador del usuario
 * y solo mientras la pestaña esté abierta. No se envía a ningún servidor, no
 * usa cookies y se borra al cerrar la pestaña (o con "Quitar mis documentos").
 * Se guardan las filas ya leídas (facturas y movimientos), no los archivos.
 * Si el navegador no permite `sessionStorage`, queda en memoria y las
 * herramientas funcionan igual, cada una por separado.
 */
import { asignarLibro, validarRut, COLUMNAS_FACTURA } from "./ave-herramientas.js";

const CLAVE = "ave.sesion.v1";
const VACIA = () => ({ facturas: [], movimientos: [], archivos: [], rut: "", ejemplo: false, fechaRef: "", ajustes: {} });

/* La verdad vive en sessionStorage y se relee en cada lectura: así una página
   que vuelve desde la caché de navegación (botón Atrás) o dos pestañas del
   mismo origen nunca trabajan con una copia vieja ni la reescriben.
   `memoria` es solo un respaldo: la sesión de esta página cuando el navegador
   no tiene sessionStorage o cuando lo último que se guardó no cupo. */
let memoria = null;
let sinGuardar = false;

function almacen() { try { return window.sessionStorage; } catch { return null; } }

/** ¿Hay dónde guardar entre páginas? (sessionStorage existe). */
export function almacenDisponible() { return !!almacen(); }

/** ¿Lo que se ve en esta página quedó guardado para las demás? false si no cupo o no hay almacén. */
export function sesionGuardada() { return !sinGuardar && !!almacen(); }

/** La sesión tal como está guardada (facturas sin clasificar todavía por RUT). */
export function leerSesion() {
  const a = almacen();
  if (!a || sinGuardar) return memoria || (memoria = VACIA());
  try { const t = a.getItem(CLAVE); return t ? { ...VACIA(), ...JSON.parse(t) } : VACIA(); } catch { return VACIA(); /* sesión ilegible: se parte de cero */ }
}

/**
 * Guarda. Devuelve false si no cupo (el navegador limita el espacio): en ese
 * caso NO se borra lo que ya estaba guardado; la sesión nueva queda en memoria,
 * esta página sigue funcionando y las demás verán la versión anterior.
 */
export function guardarSesion(s) {
  memoria = s;
  const a = almacen();
  if (!a) { sinGuardar = true; return false; }
  try { a.setItem(CLAVE, JSON.stringify(s)); sinGuardar = false; return true; } catch { sinGuardar = true; return false; }
}

export function borrarSesion() {
  memoria = null; sinGuardar = false;
  const a = almacen();
  try { a && a.removeItem(CLAVE); } catch { /* nada */ }
  return VACIA();
}

/** Guarda un ajuste de una herramienta (saldo, plazos, gastos fijos…) para que las demás lo usen. */
export function guardarAjustes(cambios) {
  const s = leerSesion();
  s.ajustes = { ...s.ajustes, ...cambios };
  guardarSesion(s);
  return s.ajustes;
}

const PLANTILLA = Object.fromEntries(COLUMNAS_FACTURA.map(c => [c, ""]));
const CAMPOS_FACTURA = [...COLUMNAS_FACTURA, "libro", "estado_pago"];
const recortar = f => { const o = {}; for (const c of CAMPOS_FACTURA) if (f[c] !== undefined && f[c] !== "") o[c] = f[c]; return o; };

/* ── Duplicados entre archivos ─────────────────────────────────
   Una factura puede llegar dos veces: en su XML y en el Registro del SII, o en
   dos meses de Registro que se traslapan. Son la misma si coinciden tipo,
   folio y monto total y, además, cada RUT (emisor y receptor) coincide o falta
   en alguna de las dos (el Registro de Ventas trae solo el del cliente; el de
   Compras, solo el del proveedor). Si ambas traen RUT de emisor y son distintos,
   son facturas de proveedores distintos que comparten folio y monto: no se
   fusionan. */
const rutNorm = r => { const v = validarRut(r); return v.cuerpo || String(r || "").trim().toLowerCase(); };
const claveBase = f => [f.tipo_dte, String(f.folio).trim(), Number(f.monto_total) || 0].join("|");
const mismoRut = (a, b) => { const x = rutNorm(a), y = rutNorm(b); return !x || !y || x === y; };
// Una fila del Registro de Ventas y otra del de Compras nunca son la misma: una es una venta y la otra, una compra.
const libroRegistro = f => (f.origen === "registro_ventas" || f.origen === "registro_compras") ? f.origen : "";
const mismaFactura = (a, b) => { const la = libroRegistro(a), lb = libroRegistro(b); return !(la && lb && la !== lb) && mismoRut(a.rut_emisor, b.rut_emisor) && mismoRut(a.rut_receptor, b.rut_receptor); };

/* Un movimiento es el mismo si coinciden todos sus campos, pero solo se puede afirmar si trae saldo:
   dos cartolas sin columna de saldo pueden tener una comisión idéntica el mismo día en cuentas distintas. */
const tieneSaldo = m => m.saldo !== "" && m.saldo != null;
const claveMov = m => [m.fecha, m.descripcion, m.referencia, m.cargo, m.abono, m.saldo].map(v => v == null ? "" : String(v)).join("|");

/**
 * Agrega a la sesión lo leído de un archivo. Si el archivo ya estaba (mismo
 * nombre), lo reemplaza. Lo que ya está en OTRO archivo se omite: las facturas
 * repetidas (ver arriba) y los movimientos idénticos (misma fecha, descripción,
 * referencia, cargo, abono y saldo) siempre que traigan saldo, por ejemplo la misma cartola con otro
 * nombre o dos descargas que se traslapan. Dos movimientos idénticos dentro del
 * mismo archivo se conservan: dos transferencias iguales el mismo día existen.
 * Al repetirse una factura se conserva la fila que ya estaba, completándole los
 * campos vacíos con los de la nueva.
 * @param {{nombre:string, tipo:string, facturas?:object[], movimientos?:object[], banco?:string}} leido
 * @returns {{duplicadas:number, movimientosOmitidos:number}}
 */
export function agregarArchivo(leido) {
  const s = leerSesion();
  s.facturas = s.facturas.filter(f => f.archivo !== leido.nombre);
  s.movimientos = s.movimientos.filter(m => m.archivo !== leido.nombre);
  s.archivos = s.archivos.filter(a => a.nombre !== leido.nombre);
  const vistas = new Map();
  for (const f of s.facturas) { const k = claveBase(f); (vistas.get(k) || vistas.set(k, []).get(k)).push(f); }
  let duplicadas = 0, n = 0;
  for (const f of leido.facturas || []) {
    const r = recortar({ ...f, archivo: leido.nombre });
    const k = claveBase(r), candidatas = vistas.get(k) || [];
    const previa = candidatas.find(c => mismaFactura(c, r));
    if (previa) {
      duplicadas++;
      for (const c of CAMPOS_FACTURA) if ((previa[c] === undefined || previa[c] === "") && r[c] !== undefined && r[c] !== "" && c !== "archivo") previa[c] = r[c];
      // Si cualquiera de las dos viene de un Registro del SII, la fila fusionada es la del Registro: es quien dice si es venta o compra.
      if (libroRegistro(r) && !libroRegistro(previa)) { previa.origen = r.origen; if (r.libro) previa.libro = r.libro; }
      continue;
    }
    candidatas.push(r); vistas.set(k, candidatas); s.facturas.push(r); n++;
  }
  // Movimientos: se comparan contra los de otros archivos, uno a uno (si el otro archivo tiene dos iguales y éste uno, se omite uno).
  const existentes = new Map();
  for (const m of s.movimientos) { if (!tieneSaldo(m)) continue; const k = claveMov(m); existentes.set(k, (existentes.get(k) || 0) + 1); }
  let movimientosOmitidos = 0;
  for (const m of leido.movimientos || []) {
    const k = claveMov(m), hay = tieneSaldo(m) ? existentes.get(k) || 0 : 0;
    if (hay > 0) { existentes.set(k, hay - 1); movimientosOmitidos++; continue; }
    s.movimientos.push({ ...m, archivo: leido.nombre }); n++;
  }
  s.archivos.push({ nombre: leido.nombre, tipo: leido.tipo, n, banco: leido.banco || "" });
  guardarSesion(s);
  return { duplicadas, movimientosOmitidos };
}

export function quitarArchivo(nombre) {
  const s = leerSesion();
  s.facturas = s.facturas.filter(f => f.archivo !== nombre);
  s.movimientos = s.movimientos.filter(m => m.archivo !== nombre);
  s.archivos = s.archivos.filter(a => a.nombre !== nombre);
  if (!s.archivos.length) { s.ejemplo = false; s.fechaRef = ""; s.ajustes = {}; }
  guardarSesion(s);
}

/**
 * Si los documentos sin clasificar (XML, tablas) comparten un único RUT en
 * todos ellos, ese es el de la empresa. Con un solo documento, o si dos RUT
 * aparecen en todos, no se puede saber y se devuelve "".
 */
export function inferirRut(facturas) {
  const sueltas = facturas.filter(f => !f.libro && f.origen !== "registro_ventas" && f.origen !== "registro_compras");
  if (sueltas.length < 2) return "";
  const cuenta = new Map();
  for (const f of sueltas) for (const r of new Set([validarRut(f.rut_emisor).cuerpo, validarRut(f.rut_receptor).cuerpo])) if (r) cuenta.set(r, (cuenta.get(r) || 0) + 1);
  const enTodas = [...cuenta].filter(([, n]) => n === sueltas.length).map(([r]) => r);
  if (enTodas.length !== 1) return "";
  const f = sueltas[0];
  return validarRut(f.rut_emisor).cuerpo === enTodas[0] ? validarRut(f.rut_emisor).rut : validarRut(f.rut_receptor).rut;
}

const NOMBRE_MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesCorto = iso => `${NOMBRE_MES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "may 2026 a jul 2026" a partir de una lista de fechas ISO. */
export function periodo(fechas) {
  const f = fechas.filter(Boolean).sort();
  if (!f.length) return "";
  const a = mesCorto(f[0]), b = mesCorto(f.at(-1));
  return a === b ? a : `${a} a ${b}`;
}

/**
 * La sesión lista para calcular: facturas ya separadas en ventas y compras.
 * @returns {{ventas:object[], compras:object[], sinLibro:object[], movimientos:object[], archivos:object[],
 *            rut:string, rutInferido:string, ejemplo:boolean, fechaRef:string, ajustes:object, vacia:boolean,
 *            tiene:{ventas:boolean, compras:boolean, cartola:boolean}}}
 */
export function datos() {
  const s = leerSesion();
  const rutInferido = s.rut ? "" : inferirRut(s.facturas);
  const facturas = asignarLibro(s.facturas.map(f => ({ ...PLANTILLA, ...f, libro: f.libro === "Venta" ? "ventas" : f.libro === "Compra" ? "compras" : f.libro })), s.rut || rutInferido);
  // Las guías de despacho (DTE 52) solo acompañan el traslado de mercadería: no generan IVA ni
  // ingreso, y la venta la da la factura. Contarlas duplicaba el IVA y el PPM (DL 825, art. 55).
  const tributarios = facturas.filter(f => String(f.tipo_dte) !== "52");
  const ventas = tributarios.filter(f => f.libro === "ventas"), compras = tributarios.filter(f => f.libro === "compras");
  const movimientos = [...s.movimientos].sort((a, b) => (a.banco || "").localeCompare(b.banco || "") || 0);
  return {
    ventas, compras, sinLibro: tributarios.filter(f => !f.libro), guias: facturas.length - tributarios.length, movimientos, archivos: s.archivos,
    rut: s.rut, rutInferido, ejemplo: s.ejemplo, fechaRef: s.fechaRef, ajustes: s.ajustes || {},
    vacia: !s.archivos.length,
    tiene: { ventas: ventas.length > 0, compras: compras.length > 0, cartola: movimientos.length > 0 }
  };
}

/**
 * Las cuentas bancarias que se deducen de las cartolas subidas. No se confía
 * en los nombres: se deducen por períodos.
 *
 * Cada archivo es un tramo, con su período (primera y última fecha de sus
 * movimientos, ya sin los repetidos de otro archivo) y su saldo de cierre (el del
 * movimiento más reciente que trae saldo; con varios el mismo día se respeta el
 * orden del archivo, porque hay bancos que exportan del más reciente al más
 * antiguo). Dos tramos pueden ser la misma cuenta solo si no son de bancos
 * reconocidos y distintos (`sinBanco: true` marca el movimiento cuyo banco no se
 * reconoció). Entre tramos que pueden ser la misma cuenta: si sus períodos no se
 * traslapan (compartir el día del borde se acepta), son la misma cuenta y vale
 * el saldo de cierre del más reciente; si se traslapan, son cuentas distintas.
 * Los tramos sin saldo no aportan cuenta.
 * @param {object[]} movimientos
 * @returns {{banco:string, reconocido:boolean, desde:string, hasta:string, saldo:number, archivos:string[]}[]}
 */
export function cuentasDeCartola(movimientos) {
  const porArchivo = new Map();
  for (const m of movimientos || []) { const k = m.archivo || ""; (porArchivo.get(k) || porArchivo.set(k, []).get(k)).push(m); }
  const tramos = [];
  for (const [archivo, ms] of porArchivo) {
    const fechas = ms.map(m => m.fecha).filter(Boolean);
    const conSaldo = ms.filter(m => m.fecha && m.saldo !== "" && m.saldo != null && Number.isFinite(Number(m.saldo)));
    if (!conSaldo.length) continue;
    const desde = fechas.reduce((a, b) => b < a ? b : a), hasta = fechas.reduce((a, b) => b > a ? b : a);
    const descendente = ms[0].fecha > ms.at(-1).fecha;
    const ultimaFecha = conSaldo.reduce((a, m) => m.fecha > a ? m.fecha : a, "");
    const delDia = conSaldo.filter(m => m.fecha === ultimaFecha);
    const cierre = descendente ? delDia[0] : delDia.at(-1);
    const reconocida = ms.find(m => m.banco && !m.sinBanco);
    tramos.push({ archivo, desde, hasta, saldo: Number(cierre.saldo), banco: reconocida ? reconocida.banco : "", etiqueta: ms.find(m => m.banco)?.banco || archivo.replace(/\.\w+$/, "") });
  }
  tramos.sort((a, b) => a.desde.localeCompare(b.desde) || a.hasta.localeCompare(b.hasta) || a.archivo.localeCompare(b.archivo));
  const cuentas = [];
  const traslapa = (a, b) => a.desde < b.hasta && b.desde < a.hasta;
  for (const t of tramos) {
    const candidatas = cuentas.filter(c => (!c.banco || !t.banco || c.banco === t.banco) && !c.tramos.some(x => traslapa(x, t)));
    // La que termina más cerca de donde empieza este tramo; a igualdad, la del mismo banco.
    candidatas.sort((a, b) => b.hasta.localeCompare(a.hasta) || (b.banco === t.banco) - (a.banco === t.banco));
    let c = candidatas[0];
    if (!c) { c = { banco: "", etiqueta: t.etiqueta, tramos: [], hasta: "" }; cuentas.push(c); }
    c.tramos.push(t);
    if (t.banco) { c.banco = t.banco; c.etiqueta = t.banco; } else if (!c.banco) c.etiqueta = t.etiqueta;
    if (t.hasta >= c.hasta) { c.hasta = t.hasta; c.saldo = t.saldo; }
  }
  return cuentas.map(c => ({ banco: c.etiqueta, reconocido: !!c.banco, desde: c.tramos.map(t => t.desde).sort()[0], hasta: c.hasta, saldo: c.saldo, archivos: c.tramos.map(t => t.archivo) }));
}

/**
 * Saldo en banco según las cartolas: la suma del saldo de cierre de cada cuenta
 * (ver cuentasDeCartola). Devuelve null si ninguna cartola trae saldo.
 */
export function ultimoSaldo(movimientos) {
  const cuentas = cuentasDeCartola(movimientos);
  return cuentas.length ? cuentas.reduce((s, c) => s + c.saldo, 0) : null;
}

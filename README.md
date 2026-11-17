# herramientas-pyme

**Herramientas abiertas para ordenar la información de una pyme chilena: facturas del SII,
cartolas bancarias, cuadratura, cobranza, flujo de caja, F29 y honorarios.**

Funcionan como biblioteca de JavaScript, en el navegador y como **servidor MCP**, para que su
asistente de IA (Claude, u otro compatible) pueda leer sus documentos y responder con números
exactos.

- **Deterministas.** La misma entrada da siempre el mismo resultado. Los cálculos se hacen con
  reglas y fórmulas, no con IA: son exactos, verificables y no cuestan nada por uso.
- **Privadas.** Todo corre en su computador. Ningún documento se envía a AVE ni a terceros.
- **Libres.** Licencia MIT: úselas, modifíquelas e intégrelas, también con fines comerciales.

---

## Qué puede hacer

| Herramienta (MCP) | Qué resuelve |
|---|---|
| `leer_facturas` | Un lote de facturas (XML del SII, PDF o el Registro de Compras y Ventas) en una sola tabla: folio, fecha, RUT, razón social, neto, exento, IVA y total |
| `leer_factura_texto` | Los campos de una factura a partir de su texto (por ejemplo, la transcripción de una foto) |
| `leer_cartola` | La cartola de cualquier banco en una tabla estándar, con el saldo verificado movimiento a movimiento |
| `cuadrar_banco_facturas` | Qué facturas están pagadas, cuáles pendientes y qué movimientos del banco no tienen respaldo |
| `cobranza_por_antiguedad` | Quién le debe, cuánto y desde cuándo, por tramo, con borradores de correo de cobranza |
| `flujo_caja_13_semanas` | La caja proyectada semana a semana, con la semana más estrecha |
| `estimar_f29` | El IVA y el PPM del mes, por separado: la tasa del PPM según régimen y mes (Ley 21.755), sobre lo cobrado en los regímenes Pro Pyme |
| `radiografia_ventas_compras` | Evolución mensual, principales clientes y proveedores, concentración de la venta |
| `clasificar_gastos` | Cada gasto con su categoría, según reglas que usted puede ver y cambiar |
| `calcular_honorario` · `revisar_informe_honorarios` | Retención de boletas de honorarios con la tasa de cada año, y revisión del informe del SII |
| `base_presupuesto` | El promedio mensual histórico de ventas y de cada categoría de gasto |
| `validar_ruts` | Dígito verificador, formato y duplicados en una lista de RUT |
| `costo_del_desorden` | Las horas y el dinero que se van al mes en tareas manuales de información |

---

## Conectarlo a su asistente de IA

Requiere [Node.js](https://nodejs.org) 18.17 o superior.

### Claude Code

```bash
claude mcp add herramientas-pyme -- npx -y github:AVEjecutivo/herramientas-pyme
```

### Claude Desktop

En **Configuración › Desarrollador › Editar configuración**, agregue al archivo
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "herramientas-pyme": {
      "command": "npx",
      "args": ["-y", "github:AVEjecutivo/herramientas-pyme"]
    }
  }
}
```

Reinicie Claude Desktop. Las herramientas aparecerán en el ícono de conectores.

### Otros agentes

Cualquier cliente MCP que use transporte `stdio` puede ejecutarlo con el comando
`npx -y github:AVEjecutivo/herramientas-pyme`.

### Qué pedirle

Una vez conectado, puede escribirle a su asistente en lenguaje natural, indicando dónde están
sus archivos:

- *"Lee las facturas de la carpeta Documentos/Junio y guárdame una tabla para Excel."*
- *"Cruza la cartola de julio con mis Registros de Compras y Ventas y dime qué está pendiente."*
- *"¿Qué clientes me deben hace más de 60 días? Prepárame los correos de cobranza."*
- *"Estima mi F29 de junio. Estoy en Pro Pyme General; te paso también la cartola."*
- *"Proyecta mi caja de las próximas 13 semanas con un saldo de $5.000.000."*

---

## Usarlo como biblioteca

```bash
npm install github:AVEjecutivo/herramientas-pyme
```

```js
import { leerFacturas, leerCartola, conciliar, estimarF29 } from "herramientas-pyme";
import { readFileSync } from "node:fs";

const { facturas } = await leerFacturas(["RegistroVentas.csv", "RegistroCompras.csv"]);
const { movimientos } = leerCartola(readFileSync("cartola.csv", "utf8"), "cartola-bci.csv");
const cruce = conciliar(movimientos, facturas);
const f29 = estimarF29({ ventas: facturas.filter(f => f.libro === "ventas"),
                         compras: facturas.filter(f => f.libro === "compras"),
                         mes: "2026-06", regimen: "propyme", movimientos });
// La tasa del PPM sale de la ley (0,125% en Pro Pyme General hasta dic-2027) salvo que pase tasaPPM.
```

`src/ave-herramientas.js` no tiene dependencias y funciona igual en el navegador
(`import ... from "herramientas-pyme/navegador"`). Es la misma biblioteca que usan las
herramientas web de [miavejecutivo.com/herramientas](https://miavejecutivo.com/herramientas/).

### Formato de los datos

- Fechas en formato ISO (`aaaa-mm-dd`), montos como enteros en pesos y RUT con puntos y guion.
- Una fila de factura tiene: `archivo, tipo_dte, tipo_documento, folio, fecha_emision,
  rut_emisor, razon_social_emisor, rut_receptor, razon_social_receptor, monto_neto,
  monto_exento, iva, monto_total, origen, confianza, observaciones` y, cuando se puede
  determinar, `libro` (`ventas` o `compras`).
- Las notas de crédito (tipo 61) restan.
- Los CSV de salida usan punto y coma y UTF-8 con BOM: se abren bien en Excel en español y en
  Google Sheets.

---

## Lo que no hace (y conviene saber)

- **No declara impuestos.** El F29 es una estimación con sus datos; la declaración la valida y
  la presenta su contador.
- **No lee imágenes.** Los PDF escaneados y las fotografías se marcan para revisión. Si su
  asistente tiene visión, puede transcribir el documento y usar `leer_factura_texto`, que
  verifica que los montos cuadren.
- **Los PDF se leen por reglas del formato impreso del SII.** Funciona con los formatos
  habituales, pero una plantilla muy distinta puede quedar con confianza "media" o "baja".
  El XML siempre es la vía exacta.
- **Cartolas:** se reconocen por sus encabezados (Fecha, Cargo, Abono, Saldo…). Si su banco
  exporta en un formato que no se lee bien, abra un reporte con un ejemplo **sin datos reales**.
- Los ejemplos de `ejemplos/` son **ficticios**: empresas, RUT y montos inventados.

---

## Contribuir

Los reportes de errores y las mejoras son bienvenidos, sobre todo formatos de cartolas y de
facturas en PDF que no se lean bien. Al abrir un reporte, **nunca adjunte documentos reales**:
reemplace nombres, RUT y montos.

```bash
npm install
npm test        # biblioteca + servidor MCP
```

## Sobre AVE

Estas herramientas las desarrolla [AVE](https://miavejecutivo.com), una consultoría chilena que
acompaña a pymes a construir su propio ecosistema de datos con IA. Una herramienta ordena una
foto de hoy; un ecosistema hace que la información llegue sola, cuadrada y al día, todos los
meses. Los primeros meses nosotros levantamos y ordenamos su información y generamos los
informes, capacitando a su equipo en todo momento; luego construimos juntos, y al cabo de un
año su equipo construye sus propias mejoras de forma autónoma.

Si quiere conversarlo: [miavejecutivo.com](https://miavejecutivo.com) ·
contacto@miavejecutivo.com

## Licencia

[MIT](LICENSE) © 2026 AVE (miavejecutivo.com)

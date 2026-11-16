# herramientas-pyme — instrucciones para agentes que contribuyen

Repositorio **público** (MIT) de AVE. Herramientas deterministas para documentos tributarios y
bancarios chilenos, como biblioteca y como servidor MCP.

## Reglas
- **Determinista primero.** Nada de llamadas a IA ni a servicios externos dentro de `src/` o
  `mcp/`. Todo corre local; es la promesa de privacidad del proyecto.
- **`src/ave-herramientas.js` no tiene dependencias** y debe seguir funcionando en el navegador.
  Es la misma biblioteca que usa miavejecutivo.com/herramientas: un cambio acá se copia allá
  (repositorio privado de AVE, `negocio/comercial/sitio/herramientas/lib/`) y viceversa.
- **Nunca datos reales.** Ejemplos y pruebas usan solo `ejemplos/` (ficticios). Los RUT de
  ejemplo deben tener dígito verificador válido salvo que la prueba sea justamente un RUT malo.
- **Español formal y chileno** en textos, descripciones de herramientas y mensajes de error.
  Errores que dicen qué pasó y cómo arreglarlo.
- Fechas ISO, montos enteros en pesos, RUT con puntos y guion. Las notas de crédito restan.
- Toda estimación tributaria lleva la advertencia de validarla con un contador.
- `npm test` debe pasar (biblioteca + servidor MCP) antes de subir cambios.

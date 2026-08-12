# AhorroMVD — Response Playbook

Respuestas objetivo del copiloto conversacional (capa Response Generator +
memoria conversacional de corto plazo). Todo lo marcado **[real]** sale tal
cual de los datos hoy en la base local (seed de desarrollo, fecha de
referencia **12/08/2026**) — se puede reproducir corriendo `npm run db:seed`
y probando esos mensajes. Las secciones deterministas (memoria, cálculo de
ahorro, confirmación/espera corta) muestran el texto EXACTO que produce el
código, no una aproximación — no pasan por IA. Las secciones marcadas como
redactadas por el Response Generator son un ejemplo real capturado, pero la
IA puede variar la frase exacta entre corridas (mismo dato, otra redacción).
Lo marcado **[hipotético]** es un ejemplo de formato con datos inventados a
propósito para ilustrar un caso que no tenemos hoy en la base (nunca se
mostraría así en producción con datos reales).

Regla de fondo en todos los ejemplos: **no responder preguntas, resolver
decisiones** — una recomendación concreta primero, alternativas después,
"¿conviene esperar?" solo si hay data real que lo respalde, y como mucho
una pregunta de cierre. Y ahora: **recordar lo que ya se habló** — un
seguimiento como "600 pesos" o "y en Pocitos?" nunca debería volver a
arrancar de cero.

---

## Consultas por categoría

### "restaurantes" **[real]**

Dato de base: único restaurante con promo es McDonald's, OCA 30%, válida
recién desde el 14/08 (en 2 días) — **hoy no hay nada vigente en
Restaurantes**.

> Hoy no tengo ninguna promo vigente en restaurantes. Lo que sí veo: McDonald's
> tiene 30% con OCA a partir del jueves (en 2 días). Si tu salida puede
> esperar hasta entonces, ahí tenés la mejor opción del momento.
>
> ¿Querés que te avise apenas arranque, o preferís ver otra categoría?

Nota de diseño: esto es el caso "nada hoy, pero sí en 2-3 días" — el bot lo
dice igual, no se queda callado solo porque `bestToday` es null.

### "supermercados" / "voy al súper" **[real]**

Dato de base: solo cuentan las promos **de cadena completa** (spec: a nivel
categoría no hay una sucursal puntual en juego) — Devoto con OCA 12% y Ta-Ta
con Itaú 10%. El 20% de Santander en Ta-Ta Pocitos es de esa sucursal
específica, no de toda la cadena, así que a nivel categoría no entra (si
preguntás por "Ta-Ta" puntual sí aparece — ver la sección de comercios).

> Hoy para el súper te conviene Devoto con OCA: 12%. Ta-Ta con Itaú te da 10%
> si te queda mejor de camino.
>
> Ya reviso los próximos días y no hay nada que supere esto en supermercados,
> así que hoy es un buen momento.
>
> ¿Querés que te calcule cuánto ahorrarías según lo que pensás gastar?

### "farmacias" / "necesito una farmacia" **[real]**

Dato de base: Farmashop con Itaú 15% hoy, y Farmashop con Santander 25%
recién desde el 15/08 (en 3 días).

> Hoy la única promo activa en farmacias es **Farmashop con Itaú: 15%**.
>
> **¿Conviene esperar?** Si podés esperar 3 días, Farmashop pasa a tener 25%
> con Santander — bastante más. Si es algo urgente, hoy con Itaú ya está
> bien.
>
> ¿Es algo que podés dejar para el fin de semana, o lo necesitás ya?

---

## Consultas por comercio

### "Ta-Ta Pocitos" **[real]** — el caso de éxito documentado en `PLAN.md`

Dato de base: Santander 20% hoy (vence mañana), Itaú 10% hoy (cadena
completa), OCA 40% desde mañana — los tres, específicos o extendidos a la
sucursal de Pocitos.

> Hoy en Ta-Ta te conviene pagar con **Santander: 20%**.
>
> **¿Conviene esperar?** Sí — mañana Ta-Ta tiene 40% con OCA, el doble de
> hoy. Si tu compra no es urgente, esperar un día puede duplicar tu ahorro.
>
> ¿Querés que te calcule cuánto ahorrarías exacto según el monto?

Con monto (ej. usuario escribió "Ta-Ta Pocitos 4000"): `estimatedSavingToday`
trae `{amount: 800, cappedByBank: false}` desde el backend, y ahí sí el
Response Generator puede decir el número real:

> Hoy en Ta-Ta con Santander ahorrás 20% — sobre $4.000 son aproximadamente
> **$800**. Mañana, con el 40% de OCA, serían cerca de $1.600: casi el doble.
> Si podés esperar un día, conviene.

Nota: "Ta-Ta" a secas (sin sucursal) tiene 4 sucursales cargadas y ninguna
preferida por default → el bot pregunta `¿En cuál Ta-Ta?` antes de
responder. Es la misma regla que usa "Farmashop" abajo.

### "Farmashop Pocitos" **[real]**

> Hoy en Farmashop te conviene pagar con **Itaú: 15%**. En 3 días pasa a 25%
> con Santander — si podés esperar, ahí ahorrás bastante más.
>
> ¿Te sirve para algo de hoy o podés esperar al fin de semana?

Nota: "Farmashop" a secas también tiene 2 sucursales (Pocitos, Centro) y sin
preferida → pregunta `¿En cuál Farmashop?` primero, igual que Ta-Ta. Ambas
sucursales comparten la misma promo (de cadena completa), así que una vez
que contesta la respuesta es idéntica a la de arriba.

### "Disco" **[hipotético — no hay datos de Disco en la base hoy]**

Disco no aparece en los scrapers actuales (Itaú/Santander/OCA en
Supermercados/Farmacias/Restaurantes de Montevideo) — no existe como cadena
en la base. El bot **no debe inventar una promo** para que la conversación
se vea completa:

> No encontré promociones vigentes para Disco en los próximos 7 días.

Si en el futuro Disco entra a alguno de los scrapers, la respuesta pasa a
seguir el mismo formato que Ta-Ta arriba automáticamente — no hace falta
tocar el Response Generator, solo que el dato exista.

---

## Consultas por zona

Importante: **no tenemos coordenadas cargadas para ninguna sucursal** (0 de
8 branches tienen lat/long) y **128 de 132 cadenas no tienen ni una sola
sucursal con dirección**. Casi todas las promos son "de cadena completa"
(aplican en cualquier sucursal, no una en particular). Por eso el barrio que
el usuario menciona **nunca filtra resultados ni afirma cercanía real** — es
un dato informativo que viaja junto a la respuesta, nunca una garantía de
"esto está cerca tuyo".

Un barrio **solo** (sin comercio ni categoría, ej. "Pocitos" a secas) ya
alcanza para responder — mira las 3 categorías del MVP juntas (de cadena
completa), igual que "quiero ahorrar hoy", con el barrio pegado como dato
informativo. Antes esto caía en "no entendí"; ya no.

### "Pocitos" **[real]**

Dato de base: igual que "quiero ahorrar hoy" (más abajo) — el barrio no
cambia qué promos existen, solo viaja como contexto.

> Hoy en general lo mejor es Farmashop con Itaú, 15% — es de cadena completa,
> así que aplica en cualquier local, incluida la de Pocitos si te queda
> cerca. También tenés Devoto (OCA 12%) y Ta-Ta (Itaú 10%) para el súper.
>
> ¿Buscás algo puntual en Pocitos (súper, farmacia) o te sirve así?

Nota de diseño: el bot **no afirma** que la sucursal de Pocitos tiene esa
promo puntual — la tiene toda la cadena. Si preguntás por un comercio
puntual con sucursal ("Ta-Ta Pocitos", "Farmashop Pocitos") ahí sí entran en
juego promos específicas de esa sucursal — ver "Consultas por comercio".

### "Cordón" / "Carrasco" **[real — mismo mecanismo, sin sucursal cargada en esa zona]**

No hay ninguna sucursal con esos barrios en la base hoy, pero el mecanismo
es el mismo: el barrio nunca filtra, así que la respuesta es idéntica a la
de Pocitos arriba, solo que sin poder decir "si te queda cerca" con ninguna
sucursal concreta.

> Hoy en general lo mejor es Farmashop con Itaú, 15%. También tenés Devoto
> (OCA 12%) y Ta-Ta (Itaú 10%) para el súper — son promos de cadena
> completa, aplican en cualquier local.
>
> ¿Buscás algo puntual o te sirve así?

---

## Consultas abiertas

Estas messages no nombran comercio ni categoría — el intent parser las
marca con `wantsGeneralSavings: true` (o solo trae un barrio, ver arriba) y
el Recommendation Engine mira las 3 categorías del MVP juntas
(`BrowseByCategoryUseCase.execute(null, zone, userId)`), trayendo la mejor
oferta de **todo** Montevideo hoy (de cadena completa).

### "quiero ahorrar hoy" **[real]**

Dato de base: la mejor de cadena completa hoy es Farmashop (Itaú 15%), con
Devoto (OCA 12%) y Ta-Ta (Itaú 10%) como alternativas. En 2 días McDonald's
arranca con 30% OCA, y le gana a todo lo de hoy.

> Hoy lo que más te conviene es Farmashop con Itaú: 15%. Como alternativa,
> Devoto tiene 12% con OCA y Ta-Ta 10% con Itaú si te sirve para el súper.
>
> **¿Conviene esperar?** En 2 días McDonald's arranca con 30% de OCA —le
> gana a todo lo de hoy. Si podés esperar hasta el jueves, ahí conviene más.
>
> ¿Querés que te calcule un monto, o te muestro otra categoría puntual?

### "qué me conviene hacer" **[real — mismo motor que arriba]**

Mismo resultado que "quiero ahorrar hoy".

### "tengo que hacer el súper" **[real — mapea a categoryName: Supermercados]**

Mismo resultado que la sección "supermercados" de arriba — el intent parser
lo resuelve directo a categoría, no pasa por `wantsGeneralSavings`.

### "quiero salir a comer" **[real — mapea a categoryName: Restaurantes]**

Mismo resultado que la sección "restaurantes" de arriba.

---

## Seguimiento conversacional (memoria de corto plazo, ~30 min)

Esta es la parte nueva: el bot guarda `ConversationContext` (última
consulta + `Recommendation` resuelta) por hasta 30 minutos después de cada
respuesta con algo real que recomendar. Un mensaje de seguimiento que no
trae comercio/categoría propios (un monto suelto, un barrio nuevo, una
confirmación, un "mejor espero") completa lo que falta con esa memoria en
vez de caer en "no entendí". Pasados los 30 minutos, se trata como
conversación nueva otra vez — ver `mergeWithContext` /
`isContextFresh` (`src/domain/users/conversation-context.ts`).

### El caso que motivó esto: "farmacias" → "600 pesos" → "voy ahora" **[real, 3 turnos]**

**Turno 1** — usuario: `farmacias`. Igual que la sección "farmacias" de
arriba: bestToday Farmashop/Itaú 15%. Se guarda como contexto: `{categoryName:
'Farmacias', zone: null, amount: null}` + la Recommendation completa.

**Turno 2** — usuario: `capaz gasto 600 pesos`. El intent parser extrae
`{amount: 600}` y nada más — sin memoria, esto antes cortocircuitaba en "No
entendí bien qué buscás". Con contexto fresco, `mergeWithContext` completa
`categoryName: 'Farmacias'` desde la memoria, y el motor recalcula
`estimatedSavingToday` con el monto real:

> Perfecto. Si gastás $600 en Farmashop usando Itaú, ahorrarías aproximadamente
> **$90** y terminarías pagando cerca de **$510**.

(`browseByCategory.execute('Farmacias', null, userId, 600)` →
`estimatedSavingToday: {amount: 90, cappedByBank: false}`, `spentAmount:
600` — el Response Generator recibe ambos y por eso puede decir el monto
final, no solo el ahorro.)

**Turno 3** — usuario: `dale, voy ahora`. El intent parser marca
`confirmsRecommendation: true` y nada más. Con contexto fresco (y
actualizado en el turno 2, con el ahorro ya calculado),
`buildContextualShortReply` responde **sin volver a pasar por IA ni por el
motor** — texto fijo armado con los datos reales ya guardados:

> Perfecto. Andá con Itaú en Farmashop — 15% (unos $90 de ahorro).

### "y en Pocitos?" después de una categoría **[real]**

Turno 1: `farmacias` (igual que arriba). Turno 2: `y en Pocitos?` — el
intent parser extrae solo `{zone: 'Pocitos'}`. Como el contexto venía de una
categoría (no de un comercio puntual), el barrio se suma como dato
informativo, no como sucursal: `browseByCategory.execute('Farmacias',
'Pocitos', userId, undefined)` — mismo `bestToday`, con `zone: 'Pocitos'`
adjunto.

> En Pocitos, la mejor opción en farmacias sigue siendo Farmashop con Itaú,
> 15% — es de cadena completa así que aplica ahí también.
>
> ¿Te sirve o buscás algo más puntual de esa zona?

Si en cambio el contexto venía de un comercio puntual (ej. turno 1 fue
`Ta-Ta`), el mismo mensaje `y en Pocitos?` se interpreta distinto: el
barrio se lee como sucursal, no como zona informativa, y reconsulta
`"Ta-Ta Pocitos"` de nuevo — trae la promo específica de esa sucursal
(Santander 20%), no la de cadena completa. Ver `mergeWithContext` (la
regla `refinesBranch`).

### "mejor espero" en restaurantes **[real, determinístico]**

Turno 1: `restaurantes` (igual que la sección de arriba — hoy nada, McDonald's
en 2 días). Turno 2: `mejor espero`. El intent parser marca `prefersToWait:
true`. `buildContextualShortReply` usa el `betterSoon` ya guardado en el
contexto y responde sin IA:

> Dale, esperar conviene: en 2 días McDonald's tiene 30% con OCA. Avisame
> cuando quieras que te calcule el ahorro con un monto.

Si el usuario dice "mejor espero" sin que haya un `betterSoon` guardado (ej.
justo veníamos del súper, donde hoy ya es lo mejor de la semana),
`buildContextualShortReply` devuelve `null` a propósito — no hay nada real
que confirmar — y el flujo normal sigue de largo (misma respuesta de
"supermercados" de nuevo, sin inventar una espera que no existe).

Nota: `"y mañana?"` (pregunta explícita, no una decisión ya tomada) usa el
mismo `prefersToWait` — el mismo template de arriba ya contesta la
pregunta Y empuja la decisión, consistente con "no responder preguntas,
resolver decisiones" (sección 3 de `VISION.md`).

### "mejor espero" con monto ya conocido **[real, determinístico]**

Si el turno 2 hubiera sido con monto (ej. `farmacias` → `600 pesos` →
`mejor espero`), `betterSoon.estimatedSaving` ya viene calculado y el
template compara $ directo en vez de ofrecer calcularlo:

> Dale, esperar conviene: en 3 días Farmashop tiene 25% con Santander —
> unos $150 de ahorro (contra el 15% de hoy).

Y si esa mejora futura tuviera tope, lo dice explícito (`(tope de la
promo)`) — mismo criterio que el Response Generator con IA, ver "Qué debe
estudiar el desarrollador" #6 más abajo.

---

## Consultas de ubicación (¿dónde queda?)

Bug real reportado en producción (12/08/2026): un usuario preguntó por
farmacias, el bot recomendó "Chajá", y `"Chajá donde esta?"` respondió
**"No entendí bien qué buscás"** — el Intent Parser no extraía nada de una
pregunta de ubicación. Se agregó `asksLocation` (booleano nuevo del Intent
Parser) y se conectó `Branch.address` — que ya existía en la base para
algunas sucursales pero nunca llegaba hasta el Response Generator, ni
siquiera para responder "¿dónde está?" — hasta el `Recommendation` que
arma la IA.

### "Ta-Ta Pocitos donde esta?" **[real]**

Turno 1: `Ta-Ta Pocitos` (comercio con sucursal puntual, tiene dirección
cargada en el seed). Turno 2, la pregunta que rompía antes:

> Hoy te conviene ir al Ta-Ta de Pocitos, en Av. Brasil 2846. Si pagás con
> la tarjeta de crédito Itaú Mastercard, tenés un 10% de descuento. Si
> querés que te calcule cuánto ahorrarías, decime cuánto pensás gastar.

Nota: la dirección aparece incluso sin preguntar explícitamente por ella
(turno 1 ya la menciona) — es un dato más del comercio, no algo que se
esconde hasta que se pregunta. `asksLocation: true` lo que hace es
**priorizar** esa parte de la respuesta cuando la pregunta es
específicamente sobre ubicación.

### "Chajá donde esta?" sin dirección cargada **[hipotético — hoy en dev solo Ta-Ta/Devoto/Farmashop/McDonald's tienen sucursales con dirección]**

Cuando no tenemos `address` para esa sucursal (la gran mayoría de las 132
cadenas — ver "NO promete" abajo), el Response Generator no inventa una
ni ignora la pregunta:

> Hoy te conviene ir a Chajá y pagar con la tarjeta de crédito Itaú Visa
> para aprovechar un 15% de descuento. No tengo la dirección exacta de
> Chajá cargada, pero podés buscar el local más cercano. Si querés, decime
> cuánto pensás gastar y te calculo el ahorro en pesos.

### "y en Pocitos?" — mención de zona ahora obligatoria, no opcional **[real]**

Antes la regla decía "podés mencionar la zona" — el modelo, probado en
vivo, elegía omitirla la mayoría de las veces (se sentía como si hubiera
ignorado la pregunta). Ahora es una instrucción firme. Mismo caso de la
sección "Seguimiento conversacional" arriba, verificado de nuevo:

> Hoy te conviene ir a Farmashop y pagar con la tarjeta de crédito Itaú
> Visa para aprovechar un 15% de descuento. En Pocitos no tengo una
> sucursal específica cargada, pero esta promo aplica en cualquier local
> de Farmashop. Si querés, decime cuánto pensás gastar y te calculo el
> ahorro exacto.

---

## Casos límite ya cubiertos por el flujo (no específicos del Response Generator)

- **Usuario sin tarjetas conocidas**: el bot pregunta ANTES de responder
  ("¿Qué tarjetas tenés?") y retoma la consulta apenas contesta — ver
  `HandleWhatsAppMessageUseCase`. Aplica también a un barrio solo (ej.
  "Pocitos" de un usuario nuevo pregunta bancos antes de responder).
- **"dame todas las ofertas"**: ignora el filtro de banco para esa
  respuesta puntual, sin tocar los bancos guardados.
- **Nada vigente ni hoy ni en 7 días**: mensaje fijo, determinístico, sin
  pasar por IA — no hay nada real que redactar (`nothingFound: true`). No
  se guarda como memoria (no hay nada que valga la pena recordar).
- **Memoria vencida (>30 min)**: un seguimiento como "600 pesos" después de
  30 minutos de silencio ya no completa nada — se trata como mensaje nuevo,
  cae en la aclaración genérica si no trae su propio comercio/categoría.
- **Confirmación/espera sin contexto que respalde**: "me sirve" o "mejor
  espero" sin una `Recommendation` reciente (o sin `betterSoon` para el
  segundo caso) no inventan nada — el flujo sigue normal en vez de
  responder con un texto vacío.

## Lo que este playbook NO promete (limitación de datos, no de diseño)

- **Ubicación automática por GPS**: no implementado. El backend no recibe
  coordenadas del usuario — todo lo que el bot sabe de "dónde estás" es lo
  que el usuario escribió alguna vez como texto (`knownZone`, sin
  vencimiento) o lo que dijo en los últimos 30 minutos, y ni así filtra
  resultados por cercanía real.
- **"Sucursal más cercana" real**: requiere lat/long en `branches`, que hoy
  no existe para ninguna fila. Es un proyecto de datos (backfill de
  direcciones), no de este Response Generator.
- **Dirección para la mayoría de los comercios**: `Branch.address` ya se
  usa cuando existe (12/08/2026), pero solo las 4 cadenas del seed
  original (Ta-Ta, Devoto, Farmashop, McDonald's) tienen sucursales con
  dirección cargada — las 128 cadenas auto-descubiertas por los scrapers
  no tienen ni una sola sucursal en la base (mismo gap documentado arriba
  para GPS). Para esas, el bot es honesto ("no tengo la dirección
  cargada"), no inventa una.
- **Recordatorios reales** ("avisame cuando arranque McDonald's"): el bot
  puede *decir* que va a avisar en una respuesta redactada por IA, pero no
  hay ningún cron/job que efectivamente mande ese mensaje después — es una
  limitación conocida, no prometer esto explícitamente en texto nuevo.

---

## Qué debe estudiar el desarrollador

Cada mejora de esta vuelta tocó un concepto de IA/producto conversacional
distinto. Documentado acá para que la próxima mejora la puedas diseñar vos
mismo, no soluciones puntuales.

### 1. Extracción de intención con salida estructurada (`response_format: json_schema`)

**Qué se usa**: `OpenRouterMessageInterpreter` le pide al modelo que
devuelva JSON que cumple un schema exacto (`INTENT_JSON_SCHEMA`), no texto
libre que después hay que parsear a mano. Los 2 campos nuevos
(`confirmsRecommendation`, `prefersToWait`) se agregaron ahí: una propiedad
más en el schema, una regla más en el prompt.

**Por qué mejora el producto**: sin schema, el modelo puede devolver
prosa, un JSON con forma distinta cada vez, o inventar campos. Con
`strict: true` en el schema, la respuesta SIEMPRE tiene esa forma exacta —
podés confiar en `parsed.confirmsRecommendation` sin validar a mano ni
tener un try/catch por cada campo.

**Cómo funciona conceptualmente**: el modelo no "decide" devolver JSON
válido por buena voluntad — durante la generación, el proveedor restringe
qué tokens son válidos en cada paso según la gramática del schema
(constrained decoding). Por eso es fiable incluso con `temperature: 0`
en un caso ambiguo: la forma nunca falla, aunque el contenido puede.

**Documentación oficial de OpenAI para profundizar**:
- Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Function calling (mismo mecanismo de fondo, para cuando el modelo tiene
  que decidir ENTRE herramientas, no solo llenar un schema fijo):
  https://platform.openai.com/docs/guides/function-calling

### 2. Memoria conversacional fuera del contexto del modelo

**Qué se usa**: `ConversationContext` no es "historial de mensajes" que se
manda de vuelta al modelo en cada llamada — es un objeto chico (última
consulta + recomendación) que vive en Postgres, con un TTL de 30 minutos
resuelto en código (`isContextFresh`), y que se combina con el intent nuevo
de forma determinística (`mergeWithContext`), sin una llamada más a
OpenRouter.

**Por qué mejora el producto**: es el fix concreto al bug que motivó esta
vuelta — "capaz gasto 600 pesos" sin memoria no tiene ni comercio ni
categoría, así que no hay nada que responder. Con memoria, se completa con
lo último que se habló.

**Cómo funciona conceptualmente**: los modelos de chat completions son
*stateless* — no recuerdan nada entre llamadas HTTP. Cualquier "memoria"
la arma quien llama a la API, no el modelo. Hay dos formas de dársela: (a)
mandar el historial de mensajes completo en cada llamada (memoria "en el
contexto", cara en tokens y sin estructura), o (b) mandar solo un resumen
estructurado de lo relevante (lo que hace este proyecto: guardamos
`categoryName`/`zone`/`bestToday`, no la conversación entera). La opción
(b) es más barata, más rápida, y más fácil de razonar — a costa de que hay
que decidir vos qué vale la pena recordar.

**Documentación oficial de OpenAI para profundizar**:
- Conversation state (cómo OpenAI recomienda manejar turnos e historial):
  https://platform.openai.com/docs/guides/conversation-state
- Prompt caching (si en algún momento SÍ mandás historial largo repetido,
  esto evita re-pagar el procesamiento del prefijo fijo en cada llamada):
  https://platform.openai.com/docs/guides/prompt-caching

### 3. Cuándo NO usar IA (templates determinísticos)

**Qué se usa**: `buildContextualShortReply` arma "me sirve"/"mejor espero"
con un template de código, no con una llamada más a OpenRouter — igual que
ya hacían `CANT_UNDERSTAND_MESSAGE`, `NOT_FOUND_MESSAGE` y el mensaje de
`nothingFound` antes de esta vuelta.

**Por qué mejora el producto**: más rápido (sin ida y vuelta a la red),
más barato (sin llamada facturable), y 100% predecible — para una
confirmación corta con datos que YA se conocen con certeza, la varianza
que da un LLM no suma nada, solo agrega latencia y una superficie más
donde algo podría salir mal (timeout, respuesta rara).

**Cómo funciona conceptualmente**: no es una regla técnica, es de
producto — la pregunta a hacerse antes de agregar una llamada a IA es "¿el
lenguaje natural de entrada es realmente ambiguo, y la respuesta necesita
variar en tono/forma?". Interpretar "me sirve" (lenguaje natural libre) sí
lo necesita. Redactar la confirmación con datos ya certeros, no.

**Documentación oficial de OpenAI para profundizar**:
- Guía general de cuándo y cómo usar el modelo (para calibrar esta
  decisión con criterio, no por intuición):
  https://platform.openai.com/docs/guides/prompt-engineering

### 4. `temperature` distinto según la tarea

**Qué se usa**: el Intent Parser corre con `temperature: 0` (extracción,
queremos SIEMPRE la misma lectura del mismo mensaje). El Response Generator
corre con `temperature: 0.4` (redacción, un poco de variación de tono está
bien y hasta ayuda a que no suene repetitivo).

**Por qué mejora el producto**: si el Intent Parser tuviera temperature
alta, el mismo "Ta-Ta Pocitos" podría devolver campos distintos en llamadas
distintas — rompe la confiabilidad de todo lo que se construyó encima
(memoria, cálculo de ahorro). Si el Response Generator tuviera temperature
0, sonaría mecánico siempre con las mismas palabras.

**Documentación oficial de OpenAI para profundizar**:
- Referencia del parámetro `temperature` en la API de Chat Completions:
  https://platform.openai.com/docs/api-reference/chat/create

### 5. System instructions — personalidad y voseo sin caricatura (12/08/2026)

Desde acá en adelante, cada entrada de esta sección sigue el formato de 7
puntos que pidió el usuario en `VISION.md` §17 (más detallado que las 4
entradas de arriba, que quedan como están).

**1. Qué concepto de IA se usó**: *system instructions* (el mensaje
`role: 'system'` que va antes de cada mensaje de usuario) — específicamente
la parte de prompt engineering que define **persona y registro de voz**,
no solo qué información incluir.

**2. Por qué lo usamos**: el bug de fondo no era técnico — el Response
Generator ya redactaba bien, pero sin reglas explícitas de estilo el
modelo cae por default a una voz genérica de "asistente" (formal, con
frases como "con gusto puedo ayudarte") o, si se le pide "español
rioplatense" sin más detalle, puede sobrecorregir hacia modismos de
manual ("che", "bo") que en Uruguay real nadie usa así de seguido — spec
explícito del usuario en `VISION.md` §10: "no queremos caricaturizar el
habla uruguaya".

**3. Cómo funciona conceptualmente**: el modelo no "sabe" cómo hablás vos
ni tu público — infiere el registro de dos lugares: (a) los patrones
estadísticos de su entrenamiento (que para "español uruguayo" incluye
mucho texto que SÍ caricaturiza, tipo diálogo de ficción), y (b) las
instrucciones explícitas que le des en el system prompt. Cuanto más
específico el prompt (qué palabras evitar, qué frases preferir, qué
comparación evitar — "no suenes argentino"), menos margen le das a que
rellene el hueco con el patrón genérico/estereotipado.

**4. Cómo se usa en AhorroMVD**: `OpenRouterResponseGenerator.SYSTEM_PROMPT`
(`src/infrastructure/ai/openrouter-response-generator.service.ts`), sección
"Estilo" — lista concreta de voseo esperado (tenés, podés, decime...),
lista de palabras/modismos prohibidos (bo, che, salado, guita, gurí...),
instrucción explícita de no sonar argentino, y frases de apertura
formales prohibidas ("Estimado usuario") con alternativas preferidas
sugeridas. Es puro cambio de prompt — no toca el `Recommendation` que
recibe ni la estructura de la respuesta (mejor opción / alternativas /
conviene esperar / siguiente paso), solo CÓMO se redacta.

**5. Documentación oficial de OpenAI**: Prompt engineering guide —
https://platform.openai.com/docs/guides/prompt-engineering

**6. Qué parte es relevante para esto puntual**: la sección de esa guía
sobre darle al modelo un rol/persona claro y ejemplos de tono (few-shot
implícito vía instrucciones, no ejemplos completos) — es la misma técnica
que ya usa el prompt del Intent Parser para acotar categorías/bancos a una
lista cerrada, aplicada acá a "qué suena bien" en vez de "qué es válido".

**7. Qué podrías modificar vos para practicar**: agregá 2-3 frases
prohibidas o preferidas más que se te ocurran escuchando cómo habla la
gente real en Montevideo (no lo que "suena uruguayo" en la tele), corré
`npm run ai:test:response` antes y después del cambio y compará el % de
checks correctos — ese script nació DESPUÉS de esta entrada (ver #7 más
abajo), así que ya no hace falta comparar respuestas a mano.

### 6. Aritmética fuera del modelo — el LLM nunca calcula, solo explica (12/08/2026)

**1. Qué concepto de IA se usó**: *grounding* — darle al modelo el número
YA calculado en vez de pedirle que lo calcule él. Los LLM son
notoriamente poco confiables haciendo cuentas exactas (multiplican
tokens, no números) — cuanta más aritmética le pedís "de memoria", más
chance de que invente un resultado que suena razonable pero está mal.

**2. Por qué lo usamos**: se encontró en vivo probando esta misma vuelta.
Ta-Ta con 40% de descuento y tope de $800 sobre $4.000: el prompt
anterior solo mandaba `estimatedSavingToday: {amount: 800,
cappedByBank: true}` sin explicar la regla de qué hacer con
`cappedByBank`, y el modelo redactó *"tenés un 40% de descuento, lo que
significa que de $4.000, ahorrás $800"* — matemáticamente confuso (40%
de $4.000 son $1.600, no $800) porque nunca mencionó que había un tope
de por medio. El dato correcto ya estaba en el JSON; lo que faltaba era
la regla de CÓMO explicarlo.

**3. Cómo funciona conceptualmente**: es la misma idea de fondo que ya
regía todo el proyecto ("La IA NO debe inventar promociones") aplicada
a números en vez de a datos — el backend (`computeEstimatedSaving`,
determinístico, con test unitario) calcula el monto real considerando
el tope, y al modelo solo se le pide que lo REDACTE bien, nunca que lo
derive. Cuando el modelo tiene el resultado final servido, la única
forma de "arruinarlo" es explicándolo mal en palabras — un riesgo mucho
más chico que pedirle que multiplique porcentajes.

**4. Cómo se usa en AhorroMVD**: `Recommendation.betterSoon.estimatedSaving`
es nuevo — antes solo `estimatedSavingToday` existía, así que "conviene
esperar" nunca podía comparar $ hoy contra $ mañana, solo %. Ahora
`BrowseByCategoryUseCase` y `buildRecommendationFromSearch` calculan el
ahorro esperando con el mismo `computeEstimatedSaving` (respeta el
`capAmount` de esa promo específica). El `SYSTEM_PROMPT` del Response
Generator tiene una regla nueva de "Topes" explícita: cuando
`cappedByBank` es true, decir el % teórico Y el ahorro real, nunca solo
uno de los dos. Mismo tratamiento en el camino determinístico
(`buildContextualShortReply`, sin IA) para "voy ahora"/"mejor espero".

**5. Documentación oficial de OpenAI**: no hay una guía específica de
"la IA no sabe sumar" — lo más cercano es la de function calling/tools
(cuando el cálculo es más complejo que esto, la práctica recomendada es
delegarlo a una tool/función real, no confiar en que el modelo lo
razone en texto):
https://platform.openai.com/docs/guides/function-calling

**6. Qué parte es relevante para esto puntual**: la idea de "tool
calling" ahí es justamente devolverle control al código para operaciones
que el modelo no debería intentar solo — acá no llegamos a necesitar una
tool real porque el cálculo ya lo hacíamos ANTES de llamar al modelo
(arquitectura de 3 capas: Recommendation Engine calcula, Response
Generator redacta), pero es el mismo principio con un paso menos.

**7. Qué podrías modificar vos para practicar**: agregale a
`computeEstimatedSaving` (`src/application/search/search-message.ts`) un
caso con un `capAmount` de $0 o negativo (dato corrupto) y confirmá que
no rompe ni el cálculo ni el texto — después probá sacar la regla de
"Topes" del prompt a propósito y compará cómo redacta el mismo caso sin
la regla, para ver el efecto real de esa sola frase.

**Verificado en vivo** (2 casos, contra el modelo real): "Ta-Ta $4.000 al
40% con tope $800" ahora dice *"el descuento en teoría sería de $1.600
sobre $4.000, tu ahorro real es de $800"* — correcto. Un segundo caso más
sutil (hoy 20% sin tope = $800, mañana 40% con tope = $800 real) el
modelo notó solo, sin que se lo pidiéramos explícitamente, que esperar
NO mejora el ahorro en pesos aunque el % suba, porque ambos terminan
topeados igual — señal de que la regla nueva realmente se está usando
para razonar, no solo repitiendo un template.

### 7. Eval de redacción + robustez de extracción con preguntas fuera del patrón (12/08/2026)

**1. Qué concepto de IA se usó**: dos cosas relacionadas. (a) *Eval
harness* para texto libre — `response-eval.script.ts`, mismo espíritu que
`nlu-eval.script.ts` pero en vez de comparar campos JSON exactos, corre
*checks* (funciones que devuelven true/false) contra el texto redactado:
"¿menciona el barrio?", "¿dice el monto correcto?", "¿evita frases de
robot?". (b) *Robustez de extracción fuera de los ejemplos dados* — un
LLM con extracción estructurada tiende a anclarse fuerte en los ejemplos
del prompt; una frase con una forma gramatical distinta a todos los
ejemplos (una pregunta de ubicación, cuando todos los ejemplos eran
pedidos de compra) puede fallar en producción aunque la regla "debería"
cubrirla en teoría.

**2. Por qué lo usamos**: un bug real en producción — `"Chajá donde
esta?"` devolvía TODOS los campos en null (ni siquiera `merchantName`,
que la regla ya decía que debía extraerse "si menciona un comercio").
Ninguno de los ~20 ejemplos del prompt tenía la forma "¿[comercio] dónde
está?" — todos eran "necesito ir a X", "X 4000", etc. Agregar UN ejemplo
explícito de esa forma gramatical (y una frase aclarando "extraelo
SIEMPRE, incluso en preguntas de ubicación") lo arregló — confirmado con
`npm run ai:test`, 28/29 antes de la vuelta anterior, ahora con los casos
nuevos de `asksLocation` incluidos.

**3. Cómo funciona conceptualmente**: los "ejemplos" en un system prompt
no son solo documentación para un humano — son few-shot implícito, y el
modelo generaliza mejor CERCA de la forma de esos ejemplos que lejos. Una
regla escrita en prosa ("extraé el comercio si lo menciona") compite con
el patrón estadístico de los ejemplos concretos que sí viste. Por eso
"cubrir la regla en teoría" no es lo mismo que "cubrirla en la práctica"
— hay que probar con mensajes que se alejan de la forma de los ejemplos
existentes, no solo variaciones cercanas.

**4. Cómo se usa en AhorroMVD**: `openrouter-message-interpreter.service.ts`
tiene ahora un ejemplo explícito de pregunta de ubicación en la regla de
`merchantName`, más el campo `asksLocation` con su propio ejemplo.
`response-eval.script.ts` (nuevo, `npm run ai:test:response`) corre 6
casos contra el Response Generator real — incluye el caso del tope, el
caso de la zona ignorada, y el caso de `asksLocation` con y sin
`address` — para agarrar este tipo de regresión ANTES de que un usuario
real la encuentre, no después.

**5. Documentación oficial de OpenAI**: la guía de Structured Outputs
(la misma de la entrada #1) tiene una sección sobre las limitaciones del
enfoque — vale releerla con esto en mente:
https://platform.openai.com/docs/guides/structured-outputs

**6. Qué parte es relevante para esto puntual**: la advertencia de que
`strict: true` garantiza la FORMA de la respuesta (siempre JSON válido
con esos campos), nunca el CONTENIDO — un modelo "confundido" por una
frase rara igual devuelve JSON perfecto, solo que con todo en null. La
forma no falla nunca; el contenido sí, y eso solo se detecta probando
con casos reales, no leyendo el schema.

**7. Qué podrías modificar vos para practicar**: pensá en 3 formas
gramaticales que el prompt actual probablemente no cubre bien (ej.
"¿tiene delivery Ta-Ta?", "¿hasta qué hora abre Farmashop?", "che, ¿algo
bueno en Pocitos?") y agregalas como casos a `nlu-eval.script.ts` ANTES
de tocar el prompt — corré el eval, confirmá que fallan (o no), y recién
ahí decidí si hace falta una regla nueva. Ese orden (escribir el caso que
falla antes que el fix) es lo que evitó que este bug se colara nunca en
un test, y es la misma disciplina que TDD aplicada a prompts.

**Verificado en vivo**: `npm run ai:test` — 28/29 (97%), incluyendo los 3
casos nuevos de `asksLocation` (todos OK). `npm run ai:test:response` —
20/21 (95%); el único FAIL fue un caso de tope donde el modelo dio el
monto correcto ($800) pero no explicó el "$900 teórico" — no
determinístico (a temperature 0.4), el eval script queda para
monitorear si se repite. Reproducido también el bug real de producción
end-to-end contra la base seedeada ("Ta-Ta Pocitos donde esta?" → ahora
responde con la dirección real, "Av. Brasil 2846").

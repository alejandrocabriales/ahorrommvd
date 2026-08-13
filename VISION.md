# AhorroMVD — Objetivo de producto y evolución del asistente

> Estado: **plan aprobado, implementación NO empezada todavía** (guardado
> 2026-08-12 para continuidad entre sesiones — ver nota al final).

Quiero que tomes este documento como la definición del comportamiento que queremos construir para AhorroMVD.

No quiero que conviertas esto simplemente en un chatbot que responde preguntas sobre descuentos.

El objetivo es construir un:

# COPILOTO DE AHORRO LOCALIZADO PARA MONTEVIDEO

La propuesta de valor es:

> AhorroMVD no solamente te muestra qué descuentos existen.
> Te ayuda a decidir dónde, cuándo y con qué tarjeta te conviene comprar para ahorrar más.

---

# 1. OBJETIVO PRINCIPAL

Cuando una persona le escribe a AhorroMVD por WhatsApp, queremos que pueda conversar naturalmente y obtener una recomendación accionable.

El resultado ideal es que el usuario piense:

> "Pa, esto me sirve. Me acaba de decir algo que yo no sabía."

o:

> "Me ahorró plata."

No queremos que el usuario tenga que convertirse en experto en promociones para utilizar el producto.

AhorroMVD debe hacer ese trabajo.

---

# 2. EJEMPLO DEL RESULTADO QUE BUSCAMOS

Usuario:

"qué descuentos tengo en farmacias"

AhorroMVD debería poder responder algo parecido a:

"Hoy tenés 25% en Farmacia El Túnel y San Roque con Itaú.

Si estás buscando comprar hoy, esas son las mejores opciones que encontré cerca tuyo.

Si me decís más o menos cuánto pensás gastar, te calculo cuánto podrías ahorrar."

Si el usuario responde:

"capaz gasto 600"

AhorroMVD NO debe olvidar que estábamos hablando de farmacias.

Debe interpretar:

- contexto anterior = farmacias
- monto = $600

Y responder:

"Si gastás unos $600, con el 25% ahorrarías aproximadamente $150 y pagarías $450."

La conversación debe sentirse continua.

---

# 3. PRINCIPIO FUNDAMENTAL

NO QUEREMOS UN BUSCADOR.

QUEREMOS UN COPILOTO.

Un buscador responde:

"Estos son los descuentos."

Un copiloto responde:

"De estas opciones, esta es la que más te conviene y te explico por qué."

Siempre que sea posible:

1. entender el contexto;
2. reducir las opciones;
3. recomendar;
4. explicar brevemente por qué;
5. ofrecer el siguiente paso útil.

No devolver listas innecesariamente largas.

---

# 4. LOCALIZACIÓN

La ubicación es una parte fundamental del producto.

AhorroMVD debe trabajar, siempre que exista información disponible, con la ubicación actual o ubicación conocida del usuario como contexto por defecto.

La recomendación debería priorizar:

1. cercanía;
2. porcentaje de descuento;
3. tarjeta disponible;
4. vigencia;
5. topes y condiciones;
6. conveniencia temporal.

No tiene sentido recomendar una farmacia a 8 km si existe otra a 500 metros con un descuento apenas menor.

La ubicación debe formar parte de la decisión.

---

# 5. UBICACIÓN Y SUCURSALES

Queremos poder trabajar con:

- latitud;
- longitud;
- barrio;
- comercio;
- sucursal;
- distancia aproximada.

Ejemplo conceptual:

Usuario:

"farmacias"

Respuesta:

"Encontré estas opciones cerca tuyo:

🥇 Farmacia El Túnel
25% con Itaú
A 600 m

🥈 San Roque
25% con Itaú
A 900 m

Si querés, también puedo revisar si mañana hay una promoción mejor."

No queremos solamente "Farmacia El Túnel tiene 25%".

Queremos contexto geográfico.

---

# 6. TIEMPO: HOY VS MAÑANA

Esta debe ser una característica central de AhorroMVD.

No solamente debemos preguntar:

"¿Qué descuento hay hoy?"

También debemos poder responder:

"¿Me conviene comprar hoy o esperar?"

Ejemplo:

Hoy:
20%

Mañana:
40%

El bot debería poder decir:

"Si no precisás comprar hoy, yo esperaría hasta mañana.

Hoy tenés 20%, pero mañana hay 40%.

Si pensás gastar $4.000, serían aproximadamente $800 de ahorro hoy contra $1.600 mañana, antes de considerar el tope de la promoción."

Esto convierte información en una decisión.

---

# 7. DINERO Y CÁLCULO DE AHORRO

Cuando el usuario diga:

"voy a gastar 600"

"unos 4000"

"capaz gasto 1500"

AhorroMVD debe entender que está proporcionando el monto para el contexto actual.

No debe pedir nuevamente:

"¿En qué comercio?"

si el contexto ya está disponible.

Debe utilizar el contexto de la conversación.

Los cálculos monetarios deben ser confiables.

La IA no debe inventar cálculos.

El sistema debe utilizar los datos reales de promociones, porcentajes, topes y condiciones disponibles.

La IA debe ayudar a interpretar y comunicar el resultado.

---

# 8. MEMORIA CONVERSACIONAL

El bot debe mantener contexto conversacional de corto plazo.

Ejemplo:

Usuario:
"restaurantes"

Bot:
muestra opciones.

Usuario:
"gasto unos 2000"

Bot:
debe entender que son $2.000 para la búsqueda anterior.

Usuario:
"y mañana?"

Bot:
debe entender que pregunta por las mismas opciones/promociones pero para mañana.

Usuario:
"y en Pocitos?"

Bot:
debe entender que quiere cambiar la ubicación de la búsqueda anterior.

No queremos que el usuario tenga que repetir información que ya proporcionó.

---

# 9. CONVERSACIÓN NATURAL

El usuario puede escribir de cualquier manera:

"farmacias"

"hay descuento en farmacias?"

"quiero comprar remedios"

"tengo que ir a la farmacia"

"cuál me conviene?"

"y mañana?"

"voy a gastar 600"

"y con Santander?"

Todas esas expresiones deberían poder llevar al mismo contexto cuando corresponda.

No exigir comandos rígidos.

---

# 10. PERSONALIDAD DE AHORROMVD

AhorroMVD debe sentirse como una persona de Montevideo que conoce bien los descuentos y te ayuda a ahorrar.

Debe ser:

- cercano;
- claro;
- práctico;
- directo;
- amigable;
- natural;
- confiable.

Debe utilizar voseo de forma natural:

- tenés
- podés
- decime
- fijate
- querés
- buscás
- te conviene

IMPORTANTE:

No queremos caricaturizar el habla uruguaya.

NO abusar de:

- "bo"
- "che"
- "salado"
- "de más"
- "guita"
- "gurí"

No agregar modismos solamente para parecer uruguayo.

El tono uruguayo debe surgir principalmente de:

- voseo;
- vocabulario cotidiano;
- construcciones naturales;
- brevedad;
- cercanía.

Evitar sonar como un asistente argentino.

Evitar expresiones excesivamente porteñas.

Evitar también sonar como un robot formal.

No decir constantemente:

"Estimado usuario"

"Con gusto puedo ayudarte"

"Por supuesto"

"Según la información disponible"

Preferir:

"Sí, mirá..."

"Hoy te conviene..."

"Si podés esperar hasta mañana..."

"Encontré una opción mejor..."

"Si vas a gastar unos $2.000..."

El bot debe sonar como alguien que realmente quiere ayudarte a tomar una decisión.

---

# 11. FORMATO DE RESPUESTAS

Priorizar respuestas cortas y fáciles de leer en WhatsApp.

No devolver bloques enormes de información.

Cuando haya varias opciones:

- máximo 3-5 opciones relevantes;
- ordenar por conveniencia;
- destacar una recomendación.

No mostrar 15 comercios simplemente porque existen.

---

# 12. RECOMENDACIÓN

Cuando sea posible, AhorroMVD debe decir explícitamente:

"Yo elegiría..."

"Hoy te conviene..."

"Si podés esperar, yo esperaría..."

"De estas opciones, la mejor es..."

Pero nunca inventar información.

La recomendación debe estar basada en datos reales:

- descuento;
- tarjeta;
- ubicación;
- fecha;
- vigencia;
- tope;
- condiciones.

---

# 13. TOPES

Los topes son fundamentales.

No decir:

"Ahorrás $1.600"

si la promoción tiene un tope de $800.

En ese caso:

"El 40% sobre $4.000 serían $1.600, pero la promoción tiene un tope de $800, así que tu ahorro real sería de hasta $800."

La diferencia entre porcentaje y ahorro real debe estar clara.

---

# 14. OBJETIVO DE EXPERIENCIA

Quiero que cada interacción avance hacia una de estas acciones:

- elegir un comercio;
- elegir una tarjeta;
- elegir un día;
- calcular ahorro;
- comparar alternativas;
- decidir esperar;
- encontrar una opción cercana.

Evitar conversaciones que solamente entregan información sin ayudar a decidir.

---

# 15. EVOLUCIÓN DEL PRODUCTO

NO implementar todas estas funcionalidades automáticamente.

Primero debe quedar bien resuelto el MVP.

Después de que el MVP esté en producción y tengamos usuarios reales, podremos evolucionar hacia:

### Perfil

"Tenés Itaú y OCA."

### Historial

"La última vez ahorraste $720."

### Presupuesto

"Este mes llevás gastados $18.400 de $30.000."

### Hábitos

"Normalmente hacés el súper los martes."

### Planificación

"Esta semana te conviene comprar el miércoles."

### Alertas

"Mañana Ta-Ta tiene 40%, bastante más que hoy."

Estas funcionalidades deben considerarse una evolución, no requisitos del MVP actual.

---

# 16. PRINCIPIO DE IA

La IA no debe ser responsable de inventar información financiera.

La información importante debe provenir de los datos reales del sistema.

La IA debe principalmente:

- interpretar lenguaje natural;
- entender intención;
- mantener contexto;
- identificar entidades;
- interpretar cantidades;
- decidir qué información necesita;
- ayudar a formular una recomendación;
- redactar la respuesta naturalmente.

El sistema debe encargarse de:

- promociones;
- porcentajes;
- topes;
- fechas;
- sucursales;
- distancias;
- cálculos;
- datos de comercios.

---

# 17. DOCUMENTACIÓN Y APRENDIZAJE

Esto es MUY IMPORTANTE.

Cada vez que implementes una funcionalidad relacionada con IA, NO quiero solamente que escribas el código.

Quiero que al finalizar la implementación incluyas una sección:

## Qué debería estudiar el desarrollador

Explicá:

1. Qué concepto de IA se utilizó.
2. Por qué lo utilizamos.
3. Cómo funciona conceptualmente.
4. Cómo está siendo utilizado dentro de AhorroMVD.
5. Qué documentación oficial de OpenAI debería leer.
6. Qué parte de la documentación es relevante para esta implementación.
7. Qué debería intentar modificar por mi cuenta para practicar.

Utilizá preferentemente documentación oficial de OpenAI.

Conceptos que probablemente tendremos que estudiar durante la evolución del proyecto:

- prompting;
- system instructions;
- conversation state;
- context management;
- structured outputs;
- JSON Schema;
- function calling / tools;
- tool selection;
- extraction de entidades;
- intent classification;
- evaluación de respuestas;
- manejo de errores del modelo;
- guardrails;
- costos y latencia;
- modelos y trade-offs.

No quiero depender permanentemente de Claude para entender cómo funciona mi propio sistema.

Quiero aprender mientras construimos.

---

# 18. CRITERIO FINAL

Cada vez que tengas que decidir entre:

A) mostrar más información

o

B) ayudar al usuario a tomar una mejor decisión,

preferí B.

El objetivo de AhorroMVD no es tener la base de datos más grande de descuentos.

El objetivo es:

> "Decime qué querés comprar y yo te ayudo a decidir dónde, cuándo y con qué tarjeta te conviene hacerlo."

Ese es el producto.

---

# Nota de continuidad (agregada por Claude, 2026-08-12)

Este documento se guardó tal cual lo escribió el usuario, sin implementar
nada todavía — pidió guardarlo por si se acababan los tokens de la sesión.

**Punto de partida real al guardar esto**: en la MISMA sesión ya se
implementó la sección 8 (memoria conversacional de corto plazo, ~30 min) y
gran parte de la 3/12 (respuestas tipo copiloto, no buscador) — ver
`responses.md` y la sección "Post-launch — memoria conversacional..." en
`PLAN.md`. Ya funciona: "farmacias" → "600 pesos" → "voy ahora" en 3 turnos,
con cálculo de ahorro real y confirmación determinística. Eso cubre buena
parte de la sección 2 y 7 de este documento (el ejemplo exacto de farmacia +
$600, aunque con números reales de la base en vez de los inventados acá).

**Lo que este documento pide y todavía NO está implementado**:

- **Sección 4/5 — localización real (lat/long, distancia, "cerca tuyo")**:
  bloqueado por datos, no por diseño — 0 de 8 sucursales tienen
  coordenadas cargadas, 128 de 132 cadenas no tienen ni una sucursal con
  dirección. Es un proyecto de backfill de datos aparte antes de poder
  ordenar por cercanía real. Documentado como limitación conocida en
  `responses.md` ("Lo que este playbook NO promete").
- ~~Sección 6 — "¿me conviene hoy o esperar?" con $ hoy vs $ mañana en la
  misma respuesta~~ **HECHO (12/08/2026)**: `BetterSoon.estimatedSaving`
  es nuevo — `BrowseByCategoryUseCase` y `buildRecommendationFromSearch`
  calculan el ahorro esperando (con tope) igual que ya hacían para hoy, no
  solo para comercio puntual. El `SYSTEM_PROMPT` ahora compara $ directo
  ("$800 hoy contra $1.600 esperando"), y `buildContextualShortReply`
  (el camino sin IA) también. Validado en vivo: un caso donde esperar NO
  mejora en $ (ambos días topeados igual) — el modelo lo notó solo, sin
  que se lo pidiéramos explícitamente.
- ~~Sección 8 — "y mañana?"~~ **HECHO (12/08/2026), folded en
  `prefersToWait`**: en vez de un campo nuevo, se amplió el ejemplo del
  Intent Parser para que una pregunta explícita sobre el día siguiente
  clasifique igual que "mejor espero" — el mismo template de
  `buildContextualShortReply` ya contesta la pregunta Y empuja la
  decisión (consistente con la sección 3 de este documento). Decisión de
  diseño: no separar en un campo booleano nuevo por ahora, para no
  proliferar flags casi-duplicados sin evidencia de que hace falta
  distinguirlos.
- **Sección 9 — variantes de frase más amplias** ("tengo que ir a la
  farmacia", "cuál me conviene", "y con Santander?"): el intent parser ya
  cubre bastantes variantes (ver `nlu-eval.script.ts`), pero no está
  evaluado contra esta lista específica. Sigue pendiente.
- ~~Sección 10 — personalidad/voseo con reglas anti-caricatura
  explícitas~~ **HECHO Y VALIDADO EN VIVO (12/08/2026)**: `SYSTEM_PROMPT`
  de `OpenRouterResponseGenerator` tiene la lista explícita de voseo, las
  palabras/modismos prohibidos, la instrucción de no sonar argentino, y
  las frases formales prohibidas con alternativas — ver "Qué debe
  estudiar el desarrollador" #5 en `responses.md`. Probado con 4 mensajes
  reales contra el modelo real (farmacias, restaurantes, supermercados,
  Ta-Ta con tope): tono natural, sin modismos forzados, sin frases de
  robot formal, siempre cierra con una sola pregunta.
- ~~Sección 13 — topes explicados en texto~~ **HECHO Y VALIDADO EN VIVO
  (12/08/2026)**: regla nueva en el `SYSTEM_PROMPT` ("Topes") — cuando
  `cappedByBank` es true, decir el % teórico Y el ahorro real, nunca solo
  uno. Este era justo el bug encontrado en vivo la vez anterior ("tenés
  40%... ahorrás $800" sin explicar de dónde salía ese número) — ahora
  dice explícito "el descuento en teoría sería de $1.600 sobre $4.000,
  tu ahorro real es de $800". Ver "Qué debe estudiar el desarrollador" #6
  en `responses.md` (aritmética fuera del modelo).
- **Sección 15 — evolución (perfil, historial, presupuesto, hábitos,
  alertas reales)**: explícitamente fuera de alcance del MVP según el
  propio documento, no arrancar sin que el usuario lo pida.
- ~~Sección 17 — formato "Qué debería estudiar el desarrollador" con 7
  puntos~~ **EN USO desde el 12/08/2026**: las entradas #5 y #6 de
  `responses.md` ya siguen el formato nuevo. Las entradas #1-4 (de la
  vuelta anterior) quedan con el formato viejo, no se retrofitearon.

**Sugerencia de por dónde arrancar la próxima vez** (no decidido, a
confirmar con el usuario): quedan sueltas la sección 9 (evaluar variantes
de frase más amplias contra `nlu-eval.script.ts` — barato, es solo
agregar casos) y la 4/5 (localización real con lat/long — la más grande,
depende de un proyecto de datos aparte, no debería ser lo primero). Todo
lo demás de las secciones 1-14, 16-18 ya está implementado o
explícitamente fuera de alcance (sección 15).

**Sección 4/5, alcance confirmado con el usuario (12/08/2026, sesión del
bug de Soho/Chajá) — ya no es solo "distancia real", son 4 piezas
concretas**, en orden de dependencia:

1. **Geocodificar el barrio dicho por el usuario** ("Barrio Sur" →
   coordenadas) — no existe ningún paso de geocoding hoy, todo lo que
   hay es `zone: string | null` sin resolver a nada. Reusar
   `GOOGLE_PLACES_API_KEY` (ya configurada, usada hoy solo para el
   backfill de sucursales).
2. **Filtrar/ordenar candidatos por distancia real**, no por % más alto
   a secas — reemplaza el `pickBest` actual de
   `compute-promotion-comparison.ts` (hoy: descuento desc, después
   `capAmount` desc, sin geografía) para `BrowseByCategoryUseCase`. Ya
   hay lat/long reales por sucursal verificada (backfill de hoy) para
   apoyarse.
3. **Preguntar la zona cuando no la tenemos**, en vez de recomendar a
   ciegas — mismo patrón que ya existe para preguntar bancos
   (`ASK_BANKS_MESSAGE` / `pendingQuery` en
   `HandleWhatsAppMessageUseCase`), pero para ubicación.
4. **Ciudad ≠ barrio**: "vivo en Maldonado" es un override de ciudad
   completo (`knownCity`, nuevo, mismo patrón que `knownZone` hoy),
   default Montevideo si no lo dice. Requiere poder correr el backfill
   de Places con sesgo a otra ciudad (hoy el centro está hardcodeado a
   Montevideo en `GooglePlacesBranchDirectoryProvider`).

   **HECHO PARCIAL (13/08/2026)** — la mitad "detectar y guardar" está
   implementada y probada: `ParsedIntent.city` (nuevo, distinto de
   `zone` — un barrio de Montevideo NUNCA va acá), `SetUserCityUseCase`
   guarda `User.knownCity` apenas se detecta (igual que bancos, no
   depende de que haya un tema que responder), y
   `HandleWhatsAppMessageUseCase` avisa honestamente en vez de aplicar
   datos de Montevideo cuando el usuario tiene una ciudad distinta
   guardada y pide una categoría o "lo mejor en general" — un comercio
   puntual (`merchantName`) sigue resolviéndose igual sea cual sea la
   ciudad. La mitad "servir de verdad otra ciudad" (biasear Places a
   Maldonado, backfillear sucursales reales ahí) **deliberadamente NO
   se hizo** — sin eso, "guardar la ciudad" solo podía significar
   "avisar que todavía no hay datos ahí", nunca dar una recomendación
   real. Es un proyecto de datos aparte (mismo tamaño que el backfill de
   Montevideo, por cada ciudad nueva), no una bandera para prender.

**Caso real que disparó esto** (no hipotético): usuario con tarjetas
Itaú+OCA únicamente, `knownZone: "barrio sur"`, preguntó por
restaurantes — las ÚNICAS promos de Restaurantes vigentes para
Itaú/OCA hoy son Soho (Punta del Este) y Chajá, ambas sin sucursal
verificada en Montevideo; todas las alternativas reales (Porto Vanila,
BBC Burger & Sushi, etc.) son Santander-only. El fallback de
`BrowseByCategoryUseCase` ("si no hay nada verificado, mostrar sin
filtrar antes que decir 'no encontré nada'") terminó recomendando Soho
con el mismo tono seguro que una promo real, sin aclarar que está a 2
horas de Montevideo. Con las piezas 1-4 arriba, la respuesta correcta
sería preguntar el barrio si falta, y si de verdad no hay nada
verificado ahí cerca para esas tarjetas, decirlo explícito en vez de
sonar seguro de una opción fuera de zona.

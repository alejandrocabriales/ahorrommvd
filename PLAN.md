# PLAN — AhorroMVD MVP

Fuente de verdad de dónde estamos. Leer esto primero en cada sesión nueva
antes de tocar código.

## Producto (resumen)

Copiloto de ahorro por WhatsApp para Montevideo. No es app de finanzas
personales ni comparador genérico. Ayuda a decidir **con qué tarjeta pagar
o si conviene esperar otro día**, usando promociones bancarias reales.

Hipótesis a validar: los usuarios van a consultar un asistente de WhatsApp
**antes de comprar** para elegir tarjeta o decidir si esperar.

## Restricciones duras (no tocar hasta Fase 2)

Nada de: auth compleja, cuentas con contraseña, pagos, presupuestos, topes
exactos, hábitos/recordatorios automáticos, notificaciones masivas, OCR de
tickets, integración bancaria real, panel admin, gamificación,
suscripciones, recomendaciones semanales, inteligencia comercial.

## Alcance fijo del MVP

- Bancos: Itaú, Santander, OCA (solo 3)
- Categorías: Supermercados, Farmacias, Restaurantes (solo 3)
- Zona: Montevideo únicamente
- Comparación obligatoria: hoy vs. próximos 7 días
- Sucursales: promoción puede ser por cadena completa o por sucursal
  adherida específica (`appliesToAllBranches` + `PromotionBranch`)
- Registro de gasto post-recomendación: opcional, no crítico

## Stack

NestJS + TypeScript + PostgreSQL + Prisma ORM 7 (driver adapter, sin
engine binario) + Docker/Compose. IA (OpenAI/Gemini) solo para NLU —
nunca inventa promociones, todo sale de la DB. Búsqueda tolerante a
errores con `pg_trgm`. Clean Architecture: `domain / application /
infrastructure / presentation`.

## Roadmap y estado

### ✅ Semana 1 — Base (DONE)

- Proyecto NestJS + TypeScript + Docker + Docker Compose
- PostgreSQL corriendo en contenedor (puerto host 5433 para no chocar)
- Prisma 7 con driver adapter (`@prisma/adapter-pg`), sin binario
- Modelo de datos completo en `prisma/schema.prisma`: Bank, Category,
  MerchantChain, Branch, Promotion, PromotionBranch, User, SavingLog
- 3 migraciones aplicadas (init, pg_trgm, unique branch-per-chain)
- Seed (`prisma/seed.ts`) con datos reales de Montevideo (bancos,
  categorías, cadenas, sucursales) + promociones ilustrativas que
  reproducen el caso de éxito: Ta-Ta Pocitos hoy = Santander 20%
  (+Itaú 10% toda la cadena), mañana = OCA 40% → dispara "esperá a mañana"
- `GET /health` funcionando (`src/presentation/http/controllers`)
- README con instrucciones de arranque completas

**Desviación del spec original**: `MerchantChain` tiene `categoryId`
(no estaba en la lista literal de campos). Necesario para resolver
"necesito una farmacia" sin nombre de cadena — sin esto no se puede
filtrar `GET /search` por categoría. Documentado en README.

**Estado del repo**: todo el código de Semana 1 está en el working tree
pero **sin ningún commit todavía** (`git log` vacío). Antes de arrancar
Semana 2 conviene commitear Semana 1 como punto de partida limpio.

### 🟨 Semana 2 — Scrapers (Santander y OCA reales; Itaú bloqueado)

**Investigación de las 3 páginas reales** (necesaria antes de elegir
librería):

- **Santander** (`santander.com.uy/beneficios`): Drupal, server-rendered.
  Los ~328 beneficios ya vienen completos en el HTML de la primera carga
  (confirmado: `?page=1` devuelve los mismos ids que `?page=0`) — no hace
  falta paginar ni headless browser. `cheerio` alcanza.
- **OCA** (`oca.uy/beneficios.html`): SPA que trae los datos client-side
  desde **Contentstack** (CMS headless) — las credenciales de su *Content
  Delivery API* (de solo lectura, pensadas para llamarse desde el browser)
  están en texto plano en `oca.uy/src/js/get-data-beneficios.js`. Le
  pegamos directo a `cdn.contentstack.io` y listo — sin scraping de HTML.
- **Itaú** (`itau.com.uy/inst/beneficios.html`): SPA React (bundle ~1MB,
  incluye react-google-maps) que arma la grilla client-side. **No
  encontré la URL de datos analizando el bundle estáticamente** — no hay
  `baseURL`/`fetch(` hardcodeada visible con grep. Además el sitio separa
  campañas por página (`moda.html`, `itauweek.html`,
  `beneficiosexclusivos.html`) sin un feed único aparente.

**Implementado:**

- `domain/scraping/`: `ScrapedPromotion` (shape normalizado) y el puerto
  `BankScraper` (+ token DI `BANK_SCRAPERS`)
- `application/scraping/`:
  - `matchMerchantChain` — matchea nombre scrapeado contra `MerchantChain`
    de la DB normalizando (sin acentos/guiones/mayúsculas): `"TaTa"` ==
    `"Ta-Ta"`
  - `SyncPromotionsUseCase` — por banco: scrape → matchea cadena → dentro
    de una transacción, `deleteMany` de las promos de ese banco + `create`
    de las nuevas. Reemplazo total (no upsert): igual razón que en el
    seed, no hay clave natural real y el scraper corre diario, así que la
    foto de hoy siempre reemplaza a la de ayer. Un banco que falla no
    tumba a los otros dos (try/catch por banco)
- `infrastructure/scrapers/santander/` — real, cheerio sobre HTML
- `infrastructure/scrapers/oca/` — real, REST directo a Contentstack
- `infrastructure/scrapers/itau/` — **stub**, devuelve `[]` y loguea
  warning. Ver comentario en el archivo para el próximo paso real (hace
  falta abrir devtools/Network a mano, o Playwright)
- Cron diario 03:00 América/Montevideo (`PromotionsSyncCron`,
  `@nestjs/schedule`, ya registrado en `AppModule`)
- `npm run scrape:run` — dispara el sync a mano sin esperar al cron
  (compila con `nest build` + `node dist/...`, **no uses `tsx` acá**: su
  transform basado en esbuild no emite bien `design:paramtypes` y rompe
  la inyección de dependencias de Nest — ver nota de Notas técnicas)
- Tests unitarios de las partes puras (parsing/regex/matching):
  `santander-benefits.scraper.spec.ts`, `oca-benefits.scraper.spec.ts`,
  `merchant-chain-matcher.spec.ts`

**Limitaciones conocidas del scraping real (documentadas a propósito, no
son bugs — decisiones para no inventar datos):**

1. ~~Itaú no implementado~~ **Resuelto (11/08/2026, post-deploy).** El
   bloqueo seguía siendo real (`beneficios.html` es una SPA React sin API
   descubrible por análisis estático), pero corriendo Playwright headless
   localmente (sin necesidad del browser del usuario) encontramos que el
   sitio también sirve un feed viejo, de un sistema de campañas anterior
   a la SPA actual, que sigue activo:
   `https://www.itau.com.uy/inst/aci/inst_camp.xml` — XML plano, sin JS,
   scrapeable con un GET normal. Mezcla contenido vigente con campañas
   vencidas hace años (encontramos una de 2019 y otra de 2022 todavía
   servidas) — el scraper filtra por año explícito en el texto, no asume
   que todo lo del feed está vigente. Sin campo de categoría: solo
   auto-descubre cadena cuando el texto dice "farmacia" literal, el resto
   únicamente matchea contra el catálogo existente. Bug real encontrado
   en el parsing: el CDATA de `descripcion` a veces trae HTML pegado de
   Word como texto literal (`style="line-height:107%"`), que sin limpiar
   antes le ganaba al regex de porcentaje al descuento real — hay que
   correr `stripHtml` sobre el texto extraído del XML antes de buscar el
   `%`. Validado en vivo: 15 comercios reales, 3 persistidos (Farmacia El
   Túnel y San Roque nuevas, auto-categorizadas Farmacias).
2. **Sucursales: todo se guarda `appliesToAllBranches: true`.** Ninguno
   de los dos scrapers reales da granularidad por sucursal en la página
   de listado (Santander tiene página de detalle por comercio que no
   estamos leyendo todavía; OCA tiene un array `location` con ids sin
   resolver). El soporte real de "Ta-Ta Pocitos sí, Ta-Ta Cerro no" sigue
   siendo solo lo que carga el seed a mano.
3. **Sin distinción de tramo por tipo de tarjeta.** Cuando un comercio
   tiene "25% con Platinum/Select, 15% con crédito normal", nos quedamos
   con el primer porcentaje que aparece y no seteamos `cardName`. Perder
   precisión de tramos es mejor que inventar cuál tramo es cuál sin
   parsear con más cuidado — pendiente para cuando el motor de búsqueda
   (Semana 3) necesite esa precisión.
4. **OCA: se descartan beneficios que no aplican los 7 días de la
   semana.** El schema de `Promotion` no tiene granularidad por día
   (`validFrom`/`validUntil` son un rango de fechas plano). Un beneficio
   "solo martes" ingerido como rango de fechas plano sobreestimaría
   cuándo está disponible, así que se saltea en vez de mentir. Esto
   filtra bastante volumen de OCA (en la corrida de prueba: 22 scrapeados,
   0 persistidos — la mayoría eran multi-día o sin porcentaje limpio).
5. **Fechas sin fin explícito (Santander) usan ventana rodante de 30
   días.** El listado de Santander no da fecha de fin para la mayoría
   ("todos los días") — se asume vigente 30 días desde la corrida, y el
   cron diario la va refrescando. No es una fecha real del banco, es una
   ventana operativa nuestra.
6. **`npm run scrape:run` pisa las promos ilustrativas del seed** para
   Santander y OCA (delete-by-bank, ver diseño de `SyncPromotionsUseCase`).
   Si corrés el scraper en local y querés volver al escenario de demo
   (Ta-Ta Pocitos hoy/mañana), corré `npm run db:seed` de nuevo después.
   **Itaú NO se toca**: `ScrapingModule` lo deja afuera de la lista activa
   de `BANK_SCRAPERS` a propósito — encontramos en vivo que, al ser un
   stub que siempre devuelve `[]`, cada corrida borraba sus 2 promos
   ilustrativas del seed sin reemplazarlas por nada (bug real, ya
   arreglado). Sumarlo a la lista cuando el scraper de Itaú esté
   implementado de verdad.
7. **Para mirar la base a ojo:** `npm run db:studio` (Prisma Studio, abre
   en el browser) o `docker compose exec postgres psql -U ahorro -d
   ahorrommvd`. Los logs de `scrape:run`/el cron solo dicen cuántas filas
   tocó, no las muestran.

**Update (mismo día): catálogo de cadenas ya no es una lista a mano de 4.**
El usuario preguntó, con razón, por qué solo Ta-Ta/Devoto/Farmashop/
McDonald's si cada banco publica muchísimo más en Supermercados/Farmacias/
Restaurantes. La respuesta: esos 4 eran solo el seed de demo — el
matching original solo aceptaba promos de cadenas *ya existentes* en la
base, así que todo lo demás (cientos de comercios reales) se descartaba
aunque tuviera % limpio.

Fix real: **la categoría ahora se resuelve desde la taxonomía propia de
cada banco**, no de una lista nuestra:

- **Santander** expone un facet de categorías (`Supermercados`=21,
  `Farmacia`=23, `Ruta Gourmet`=22 ≈ Restaurantes) — filtrando el listado
  por esos 3 ids server-side, cada resultado ya viene con su categoría
  correcta. Confirmado: Ruta Gourmet solo tiene 129 comercios reales,
  125 con % parseable.
- **OCA** (Contentstack) tiene su propia taxonomía de ~19 categorías;
  solo 2 mapean 1:1 sin ambigüedad (`supermercado`, `gastronomia`).
  `salud`/`bienestar` se descartó a propósito como proxy de Farmacias:
  mezcla farmacias reales con ópticas y cuidado personal (verificado
  contra los datos reales) — clasificar mal esos comercios sería una
  forma de "inventar" dato, así que las farmacias de OCA siguen
  matcheando solo contra cadenas ya conocidas.
- `SyncPromotionsUseCase` ahora hace `merchantChain.upsert` cuando un
  comercio no matchea ninguna cadena existente PERO el scraper trajo
  `categoryName` con confianza — así el catálogo crece solo, sin tocar
  el seed a mano.

**Resultado real (11/08/2026, corrida en vivo):** Santander 128
scrapeadas → **128 guardadas, 127 cadenas nuevas** (antes: 270 → 1).
OCA 22 → 1 guardada, 1 cadena nueva (Chajá) — el resto sigue filtrado
por las reglas conservadoras de arriba (día-de-semana, sin %), no por
catálogo. Itaú sigue en 0 (stub, sin tocar). El catálogo de
`merchant_chains` pasó de 4 a **132**, y esas cadenas quedan en la base
aunque después corras `db:seed` (el seed solo resetea `promotions`, no
`merchant_chains`) — es una mejora acumulativa real para cuando arranque
el motor de búsqueda en Semana 3.

Nota: tras cualquier corrida de `scrape:run` volvés a correr
`npm run db:seed` si querés el escenario de demo (8 promos ilustrativas)
en vez de lo que haya traído la corrida real.

**Verificado (11/08/2026) — dos gaps reales, ninguno es bug:**

1. **Hipermás (Disco/Devoto/Geant/Fresh Market vía Santander) no se
   guarda, y está bien que no.** Bajé `/beneficios/disco` crudo y no hay
   un solo `%` en toda la página — es una membresía ("primer año sin
   costo"), no un descuento porcentual. `Promotion.discountPercentage`
   no tiene forma de representar eso sin inventar un número, así que el
   scraper lo descarta correctamente. Fuera de alcance del modelo actual,
   no un bug de matching.
2. **Direcciones por sucursal solo existen para las 4 cadenas del seed
   original** (Ta-Ta, Farmashop, Devoto, McDonald's) — las 128 cadenas
   auto-descubiertas no tienen ningún `Branch`, todas quedan
   `appliesToAllBranches: true`. El tab "Locales" de Santander (el que
   arma el mapa con direcciones) no viene en el HTML del server — es
   AJAX cargado por JS después, mismo tipo de bloqueo que Itaú (hace
   falta devtools de un browser real para encontrar el endpoint, no se
   puede con curl/WebFetch). **Decisión: no perseguir esto ahora** —
   Semana 3 arranca con promos a nivel cadena únicamente (sin distancia/
   dirección por sucursal para lo auto-descubierto). Retomar sucursales/
   distancia como tarea puntual más adelante, evaluando en ese momento
   scraping del AJAX de cada banco vs. Google Places API por nombre de
   comercio.

### ✅ Semana 3 — Motor de búsqueda (DONE)

Implementado, probado en vivo contra la DB real (seed de demo) y con 16
tests nuevos (50 en total en el repo).

**Capas** (`src/domain/search/`, `src/application/search/`,
`src/presentation/http/{controllers,dto}/`):

- `MerchantSearchService` — búsqueda pg_trgm en dos niveles (cadena Y
  sucursal a la vez, no en cascada) usando `similarity()` explícito con
  umbral **0.2** (no el operador `%`, que depende de una GUC de sesión
  que podría filtrarse entre queries con conexiones pooleadas). Umbral
  validado a mano contra los casos exactos del spec: tata, tta, positos,
  punta carreta.
- `resolveChainBranches` (función pura, testeada sin DB) — implementa
  el flujo del spec: 0 sucursales → la cadena entera; 1 sucursal → esa
  directo; 2+ → sucursal preferida del usuario si existe, si no
  **disambiguate** (lista de opciones, ej. "¿En cuál Ta-Ta?").
- `ResolveMerchantUseCase` — orquesta lo anterior. Con `q` en texto
  libre, si el mejor match ya apunta a una sucursal puntual (ej. "Ta-Ta
  Pocitos") resuelve directo; si es la cadena sola, dispara la lógica de
  disambiguación.
- `computePromotionComparison` (función pura) — hoy vs. próximos 7 días.
  `better` solo se llena si el % del día candidato le gana estrictamente
  al de hoy; entre empates gana el día más próximo.
- `computeEstimatedSaving` / `buildSearchMessage` — ahorro estimado
  (respeta `capAmount` del banco) y el texto en español, determinístico
  (sin IA — la redacción con IA es Semana 4, esto es un template fijo
  para poder probar el motor ya mismo por HTTP).
- Endpoints: `GET /search?q=&merchantChainId=&branchId=&userId=&amount=`,
  `GET /branches/search?q=`, `GET /promotions/upcoming?merchantChainId=&branchId=`.

**Bug real encontrado y arreglado durante las pruebas en vivo**:
`MerchantSearchService.search` originalmente descartaba el match a nivel
cadena cada vez que había *cualquier* match a nivel sucursal para esa
misma cadena — entonces "Ta-Ta" solo (query ambigua a propósito)
resolvía directo a "Ta-Ta Pocitos" en vez de preguntar. Fix: dejar que
el score decida (sin descartar nada) — "Ta-Ta" matchea la cadena con
1.0 exacto contra ~0.2-0.27 de cualquier sucursal (share el prefijo,
nada más), así que gana la cadena y dispara la pregunta; "Ta-Ta
Pocitos" matchea esa sucursal con 1.0 exacto contra 0.27 de la cadena
sola, así que gana la sucursal. Validado con `similarity()` real
post-fix vía curl contra `/search`.

**Validado en vivo (curl contra la demo del seed)**:
- `?q=Ta-Ta+Pocitos&amount=4000` → reproduce el criterio de éxito
  exacto del spec: hoy Santander 20% ($800 estimado), "pero mañana
  Ta-Ta Pocitos tiene 40% con OCA"
- `?q=tta+positos` (typos) → resuelve igual, a la misma sucursal
- `?q=Ta-Ta` solo, `?q=Farmashop` solo (2 sucursales c/u) → `disambiguate`
  con la lista de opciones
- `?q=Bardo` (una de las 128 cadenas reales sin sucursales cargadas,
  Semana 2) → resuelve a nivel cadena, sin promos en el seed de demo
  (correcto: el seed solo tiene promos para las 4 cadenas originales)
- Query sin sentido → `{"status":"not_found"}`

**Limitación heredada de Semana 2, sin cambios**: para las 128 cadenas
auto-descubiertas no hay sucursales, así que el motor no puede mostrar
dirección/distancia para esos comercios — solo para Ta-Ta, Farmashop,
Devoto y McDonald's (las 4 del seed). Decisión ya tomada: no perseguir
esto ahora, retomar más adelante.

### 🟨 Semana 4 — WhatsApp + IA (DONE) + deploy (pendiente)

**Decisión fuera del spec original**: el spec pedía "OpenAI o Gemini
únicamente". Usamos **OpenRouter** (`openai/gpt-4o` vía su API
OpenAI-compatible) en su lugar — mismo modelo final (GPT-4o), pero por
OpenRouter en vez de pegarle directo a OpenAI. Motivo: el usuario ya
tenía cuenta/key ahí.

**Implementado y validado en vivo (11/08/2026):**

- `src/domain/ai/`, `src/infrastructure/ai/` — `OpenRouterMessageInterpreter`:
  llama a `openrouter.ai/api/v1/chat/completions` con `response_format:
  json_schema` (structured output, no texto libre) para extraer
  `{merchantName, branchHint, categoryName, zone, amount}`. La IA
  **nunca** decide una promoción, solo interpreta el mensaje — el motor
  de Semana 3 sigue siendo la única fuente de verdad de qué promos
  existen. Probado con los 6 ejemplos del spec vía `npm run ai:test`,
  todos correctos (incluyendo "tata 4000" → amount:4000).
- `src/application/whatsapp/handle-whatsapp-message.use-case.ts` —
  orquesta interpretar → resolver (reusa `SearchUseCase`/
  `BrowseByCategoryUseCase` de Semana 3 tal cual, sin duplicar lógica) →
  mandar respuesta. `BrowseByCategoryUseCase` es nuevo: cuando el
  usuario no nombra un comercio puntual ("voy al súper"), muestra las
  mejores promos de hoy en esa categoría en vez de solo preguntar el
  nombre.
- `src/presentation/http/controllers/whatsapp.controller.ts` —
  `GET /whatsapp/webhook` (handshake de verificación de Meta) y
  `POST /whatsapp/webhook` (recepción + respuesta). Devuelve 200 siempre
  que el payload sea válido, incluso si falla el procesamiento interno
  (Meta reintenta y duplica mensajes si no le devolvés 200 rápido).
- `src/application/savings/register-saving.use-case.ts` — `POST
  /savings`. Si el mensaje de WhatsApp ya trae comercio + monto en el
  mismo texto (ej. "Ta-Ta 4000", justo el ejemplo del spec) y resolvió
  una sucursal puntual, se registra automático sin preguntar de nuevo.
  Validado con el ejemplo exacto del spec: `Ta-Ta Pocitos, 4000` → "Ahorraste
  aproximadamente $800. Total registrado este mes: $800", y un segundo
  registro el mismo mes acumula el total correctamente.
- Guía completa de setup de WhatsApp Cloud API (Meta for Developers) —
  probada end-to-end por el usuario contra un número real vía ngrok.

**Bug real encontrado en el setup, no en el código**: Meta devolvía
"No se pudo validar la URL de devolución de llamada o el token de
verificación" al guardar el webhook. Diagnóstico: le pegué a la URL
pública de ngrok con un token deliberadamente incorrecto (dio 403,
confirmando que el túnel + el server sí eran alcanzables) y después con
el token exacto leído de `.env` (dio 200 con el challenge correcto) —
eso aisló el problema a "lo que está tipeado en el campo de Meta no es
igual a lo que hay en `.env`", no a un bug nuestro. Se resolvió
re-copiando el token.

**Nota de seguridad de la sesión**: en un momento la API key real de
OpenRouter terminó pegada en `.env.example` (que si se commitea, va a
git) en vez de `.env` (gitignored). Se detectó por el diff antes de
cualquier `git add`/commit — nunca llegó a estar en el historial de git.
Movida a `.env` y `.env.example` restaurado a placeholder vacío.

**Pendiente real de Semana 4:**
- Deploy a Railway/Render — no arrancado, requiere cuenta del usuario
- Pruebas con usuarios reales más allá del propio número del usuario
- El flujo de WhatsApp es sin estado (cada mensaje se interpreta solo):
  no hay "¿querés registrar cuánto gastaste?" como pregunta de
  seguimiento separada — el registro solo dispara si comercio+monto
  vienen juntos en un mismo mensaje. Suficiente para el caso de éxito
  del spec, pero es una simplificación real, no el flujo conversacional
  completo que describe el spec.

### 🟩 Post-launch — deploy, hardening, personalización, copiloto conversacional (12/08/2026)

Todo lo de abajo está commiteado, testeado (100 tests unitarios) y
validado en vivo contra Postgres real + OpenRouter real (no solo mocks).
Nota: la sección "Semana 4" de arriba quedó desactualizada en varios
puntos (deploy, seguridad, flujo con estado) — esto la reemplaza.

**Deploy a producción (Railway)**: hecho. App + Postgres en el mismo
proyecto Railway, WhatsApp Cloud API con token permanente de System User
(App + WABA como assets separados), validado end-to-end con el número
real del usuario.

**Seguridad**: firma HMAC-SHA256 del webhook de Meta (`X-Hub-Signature-256`)
validada con `timingSafeEqual`, fail-closed si falta `WHATSAPP_APP_SECRET`
o el raw body. Rate limit en `/branches/search` (`@Max(50)`). Dos leaks
de secretos reales (OpenRouter key, connection string de prod) detectados
por diff antes de cualquier commit — nunca llegaron al historial de git.

**Personalización por banco** (`prisma/migrations/..._user_banks`,
`..._pending_query`): el bot solo muestra promos de los bancos que el
usuario dijo tener. Si no sabemos sus tarjetas todavía, **pregunta antes
de contestar** (no con un tip al final) y guarda la consulta como
pendiente (`User.pendingQuery`, JSON) para retomarla filtrada apenas
contesta — "dame todas" salta el filtro para esa respuesta puntual sin
tocar los bancos guardados. Ver `src/application/users/`,
`src/domain/users/pending-query.ts`.

**Copiloto conversacional (3 capas)** — pedido explícito: "no responder
preguntas, resolver decisiones", no una lista de buscador. Se separó en:

1. **Intent Parser** (IA) — `OpenRouterMessageInterpreter`, extrae
   `ParsedIntent` incluyendo ahora `showAllBanks` y `wantsGeneralSavings`
   (ej. "quiero ahorrar hoy", "qué me conviene hacer" → sin comercio ni
   categoría, mira las 3 categorías del MVP juntas).
2. **Recommendation Engine** (backend puro, CERO IA) —
   `BrowseByCategoryUseCase` y `buildRecommendationFromSearch` arman un
   `Recommendation` único (`src/domain/recommendation/recommendation.ts`):
   mejor opción hoy, hasta 3 alternativas, "¿conviene esperar?" (mejor
   opción en los próximos 7 días que le gana a la de hoy — a nivel
   categoría completa, no solo por comercio), y ahorro en $ SOLO si el
   usuario dio un monto real.
3. **Response Generator** (IA) — `OpenRouterResponseGenerator`, segunda
   llamada a OpenRouter que redacta el `Recommendation` en lenguaje
   natural decisivo (mejor opción / alternativas / conviene esperar /
   una sola pregunta de cierre). Nunca decide promociones, nunca inventa
   datos fuera del JSON que recibe. Los estados simples (no encontrado,
   desambiguar, preguntar bancos, no entendí) siguen siendo strings fijos
   — no vale la pena el costo/latencia de IA para eso.

Validado en vivo con datos reales: "Ta-Ta Pocitos" con banco filtrado
(`betterSoon: null` manejado con gracia, sin inventar que conviene
esperar), "restaurantes" con nada hoy pero algo en 2 días, "quiero ahorrar
hoy" cruzando las 3 categorías. Ver `responses.md` para el playbook
completo con ejemplos reales de la base de datos.

**Limitación real de datos, no de diseño**: 0 de 8 sucursales tienen
coordenadas cargadas, y 128 de 132 cadenas no tienen ni una sola sucursal
con dirección (son promos de cadena completa). Por eso el bot **no**
prioriza por ubicación GPS automática ni afirma cercanía real — el barrio
que el usuario escribe es informativo (`Recommendation.zone`), nunca un
filtro de proximidad. Backfill de direcciones/coordenadas queda como
proyecto de datos aparte, no de esta capa conversacional.

**Pendiente**: aplicar las migraciones `user_banks` y `pending_query` a
producción (`DATABASE_URL="<public-url>" npx prisma migrate deploy`) —
hechas y probadas en local, todavía no corridas contra la base de Railway.

### 🟩 Post-launch — memoria conversacional de corto plazo + ubicación por defecto (12/08/2026)

Pedido explícito del usuario en su rol de Head of Product: el bot se sentía
"buscador de descuentos" porque perdía el hilo apenas el usuario contestaba
algo corto ("capaz gasto 600 pesos" después de preguntar por farmacias
tiraba "no entendí bien qué buscás"). Sin cambios de arquitectura/stack —
todo dentro de las mismas 3 capas (Intent Parser / Recommendation Engine /
Response Generator) ya documentadas arriba.

**`ConversationContext`** (`src/domain/users/conversation-context.ts`,
columna nueva `users.conversation_context` Json, migración
`conversation_context_known_zone`): guarda la última consulta resuelta +
su `Recommendation` completa, con un TTL de 30 minutos
(`isContextFresh`). Se sobreescribe cada vez que hay una `Recommendation`
real que recordar — a diferencia de `pendingQuery`, no se borra al
contestar.

**`mergeWithContext`** (puro, sin IA — `src/application/users/`): un
mensaje de seguimiento sin comercio/categoría propios ("600 pesos", "y en
Pocitos?") completa los campos que faltan con el contexto fresco. Un
barrio nuevo se lee como sucursal si veníamos de un comercio puntual, o
como zona informativa si veníamos de una categoría (`refinesBranch`).

**`ParsedIntent` +2 campos**: `confirmsRecommendation` ("me sirve", "dale",
"voy ahora") y `prefersToWait` ("mañana entonces", "mejor espero") — el
Intent Parser los clasifica sin necesitar el contexto él mismo; es la capa
de aplicación la que decide qué hacer con eso.

**`buildContextualShortReply`** (puro, determinístico, sin IA): cuando el
contexto fresco alcanza para confirmar o para decir "esperar conviene",
responde con un template armado con datos ya reales — mismo criterio que
`CANT_UNDERSTAND_MESSAGE`/`NOT_FOUND_MESSAGE` ya usaban, ahora aplicado
también acá. Si no hay suficiente data (ej. pidió esperar pero no había un
`betterSoon` guardado), devuelve `null` y el flujo normal sigue de largo
en vez de inventar algo.

**`BrowseByCategoryUseCase` + monto**: ahora acepta un `amount` opcional y
calcula `estimatedSavingToday` igual que ya hacía el flujo de comercio
puntual — es lo que permite que "600 pesos" después de "farmacias" calcule
un ahorro real, no solo repita el %. `Recommendation.spentAmount` es
nuevo: junto con `estimatedSavingToday`, el Response Generator ahora puede
decir cuánto terminarías pagando, no solo cuánto ahorrás.

**Barrio solo, sin comercio ni categoría** (ej. "Pocitos" a secas): antes
cortocircuitaba en "no entendí" (ningún campo de `ParsedIntent` distinto de
`zone` se llenaba). Ahora se trata como "quiero ahorrar hoy" con el barrio
pegado de forma informativa.

**`knownZone`** (columna nueva en `users`, sin TTL): el barrio que el
usuario mencionó alguna vez queda de default para consultas futuras que no
traigan uno — nunca alcanza por sí solo para inventar un tema en un mensaje
sin nada más (ver el chequeo `hasTopic` en
`HandleWhatsAppMessageUseCase`, agregado justamente para que un "hola" con
barrio conocido no dispare una recomendación que nadie pidió).

Validado con 132 tests unitarios (antes: 100) más una verificación en vivo
contra Postgres real de los 3 ejemplos que quedaron documentados en
`responses.md` con números reales (no inventados): "farmacias" → "600
pesos" → "voy ahora" (3 turnos, memoria + cálculo + confirmación
determinística), "y en Pocitos?" después de una categoría, y "mejor espero"
en restaurantes usando el `betterSoon` ya guardado. De paso, revisando
`responses.md` contra el código real se encontraron y corrigieron 3
ejemplos ya desactualizados (el bestToday de "supermercados"/"quiero
ahorrar hoy" no era el que el código realmente calcula hoy, porque las
promos branch-specific de Ta-Ta no cuentan a nivel categoría — solo las de
cadena completa).

Detalle completo, con "qué debe estudiar el desarrollador" para cada
concepto de IA nuevo (salida estructurada, memoria fuera del contexto del
modelo, cuándo NO usar IA, `temperature` por tarea), en `responses.md`.

## Criterio de éxito del MVP

Usuario manda "Ta-Ta Pocitos" por WhatsApp → responde en <2s con
descuentos de hoy, banco conveniente, ahorro estimado, aviso si hay
mejor promo en próximos días, y opción de registrar el gasto.

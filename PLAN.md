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

### ⬜ Semana 2 — Scrapers (SIGUE ACÁ)

Próximos pasos concretos:

1. Módulo `infrastructure/scrapers/` — uno independiente por banco
   (Itaú, Santander, OCA), cada uno como su propio provider/servicio
2. Normalizador común: cada scraper devuelve promociones en un shape
   uniforme (bankId, merchantChainId, discountPercentage, paymentType,
   cardName, capAmount, validFrom, validUntil, sourceUrl) antes de
   persistir
3. Persistencia vía upsert en `Promotion` (evitar duplicados por
   bank+chain+vigencia)
4. Cron diario con `@nestjs/schedule` (ya está en `package.json`) para
   disparar los 3 scrapers
5. Guardar siempre `sourceUrl` y `updatedAt` real de scraping — el
   sistema debe poder responder "actualizado hoy a las 02:13"
6. Decidir método de scraping por banco (HTML estático vs. necesita
   headless browser) — investigar las páginas reales de Itaú/Santander/OCA
   antes de elegir librería (cheerio/playwright)

Bloqueante a resolver antes de escribir código: revisar las páginas
oficiales reales de los 3 bancos para saber si alcanza con fetch+cheerio
o hace falta Playwright (JS-rendered).

### ⬜ Semana 3 — Motor de búsqueda

- Casos de uso en `application/` (nada de lógica en controllers)
- Búsqueda tolerante a errores con `pg_trgm` (tata, ta-ta, tta, punta
  carreta, positos, etc.)
- Comparación hoy vs. próximos 7 días
- Resolución de sucursal: preferida del usuario → preguntar → inferir
- `GET /search`, `GET /branches/search`, `GET /promotions/upcoming`

### ⬜ Semana 4 — WhatsApp + IA + deploy

- WhatsApp Cloud API (`POST /whatsapp/webhook`)
- Servicio de interpretación NLU (intención estructurada: category,
  zone, merchant, branch)
- `POST /savings` (registro opcional de gasto)
- Deploy (Railway/Render)
- Pruebas con usuarios reales

## Criterio de éxito del MVP

Usuario manda "Ta-Ta Pocitos" por WhatsApp → responde en <2s con
descuentos de hoy, banco conveniente, ahorro estimado, aviso si hay
mejor promo en próximos días, y opción de registrar el gasto.

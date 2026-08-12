# AhorroMVD

Copiloto de ahorro por WhatsApp para Montevideo. Ayuda a decidir con qué
tarjeta pagar o si conviene esperar otro día, usando promociones bancarias
reales (Itaú, Santander, OCA) en supermercados, farmacias y restaurantes.

Este repo está en **Semana 4** del roadmap: base (Semana 1), scrapers
reales de Santander y OCA por cron diario (Semana 2, Itaú sigue bloqueado),
motor de búsqueda con pg_trgm y comparación hoy-vs-7-días (Semana 3), y
ahora WhatsApp Cloud API + interpretación con IA (OpenRouter/GPT-4o) +
registro opcional de gasto (Semana 4) — probado end-to-end contra un
número de WhatsApp real. Solo falta el deploy a producción.

Ver `PLAN.md` para el detalle completo del roadmap, decisiones y
limitaciones conocidas de cada semana — es la fuente de verdad de dónde
quedamos.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma ORM 7 (driver adapter `@prisma/adapter-pg`, sin engine binario)
- Docker / Docker Compose
- Búsqueda tolerante a errores con `pg_trgm`

## Arquitectura

Clean Architecture: `src/domain`, `src/application`, `src/infrastructure`,
`src/presentation`. Por ahora solo existe contenido en `infrastructure/prisma`
(conexión a base) y `presentation/http` (health check) — el resto de las
capas se va a poblar a partir de Semana 3 cuando exista el motor de
recomendaciones y los casos de uso.

## Requisitos

- Node 22+
- Docker + Docker Compose

## Arrancar en local (recomendado para desarrollar)

```bash
cp .env.example .env   # ya viene con valores de dev, no hace falta editar nada
npm install
docker compose up -d postgres
npm run db:deploy       # aplica migraciones existentes
npm run db:seed         # carga datos de ejemplo (ver nota abajo)
npm run start:dev
```

La app queda en `http://localhost:3900` (`GET /health` para verificar).

> Puerto 3900 en vez de 3000 a propósito: dejamos 3000 libre para que no
> choque con otros proyectos Node/Next que puedas tener corriendo en la
> misma máquina.

> El puerto 5432 de Postgres está mapeado a **5433** en el host
> (`docker-compose.yml`) para no chocar con otro Postgres que puedas tener
> corriendo local. Ajustá `DATABASE_URL` en `.env` si cambiás el mapeo.

## Arrancar todo con Docker (app + Postgres en contenedores)

```bash
docker compose up
```

Corre `npm run start:dev` dentro del contenedor con hot-reload (bind mount de
`src`). Útil para validar que el build de Docker funciona, no es necesario
para el día a día si ya tenés Node instalado.

## Seed de desarrollo — importante

`prisma/seed.ts` carga bancos, categorías, cadenas y sucursales reales de
Montevideo, pero **los porcentajes de descuento son ilustrativos**, no
promociones verificadas. Existen únicamente para poder desarrollar el motor
de búsqueda y la comparación hoy-vs-7-días sin depender todavía de los
scrapers (Semana 2). El seed sí reproduce el escenario del caso de éxito del
producto:

- **Ta-Ta Pocitos, hoy**: Santander 20% (además Itaú 10% aplica a toda la
  cadena).
- **Ta-Ta Pocitos, mañana**: OCA 40% — dispara la recomendación de "esperá a
  mañana".

El seed es idempotente para bancos/categorías/cadenas/sucursales (`upsert`).
Las promociones se recrean en cada corrida (`prisma migrate reset` + `db:seed`
para resetear todo desde cero).

## Probar el motor de búsqueda (Semana 3)

Con el seed de demo cargado y la app corriendo (`npm run start:dev`):

```bash
# Caso de éxito del spec: hoy Santander 20%, "pero mañana OCA 40%"
curl "http://localhost:3900/search?q=Ta-Ta+Pocitos&amount=4000"

# Tolerante a errores (pg_trgm) — misma sucursal
curl "http://localhost:3900/search?q=tta+positos"

# Cadena con varias sucursales, sin especificar cuál -> pregunta
curl "http://localhost:3900/search?q=Ta-Ta"

# Solo sucursales (sin promos, solo el fuzzy match)
curl "http://localhost:3900/branches/search?q=punta+carreta"
```

## WhatsApp + IA (Semana 4)

Requiere `OPENROUTER_API_KEY` (y opcionalmente `OPENROUTER_MODEL`, default
`openai/gpt-4o`) y, para el webhook, `WHATSAPP_TOKEN` /
`WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_VERIFY_TOKEN` en `.env` — ver
`PLAN.md` para la guía completa de setup en Meta for Developers (cuenta,
app, número de test, ngrok para exponer el webhook en local).

```bash
# Eval de la interpretación NLU contra OpenRouter/GPT-4o de verdad (sin
# mockear) — corre ~16 mensajes con la respuesta esperada y mide % de
# campos/casos correctos. Usar para comparar antes/después de tocar el
# prompt, el schema o el modelo.
npm run ai:test

# Simula un mensaje real de WhatsApp llegando al webhook (con la app corriendo)
curl -X POST http://localhost:3900/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"598...","type":"text","text":{"body":"Ta-Ta Pocitos"}}]}}]}]}'
```

`OPENROUTER_API_KEY`/`WHATSAPP_TOKEN` faltantes no rompen el boot de la
app (fallan recién al procesar un mensaje) — así que `GET /search` y los
scrapers siguen andando sin que esto esté configurado.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run start:dev` | Levanta la app con watch mode |
| `npm run build` | Compila a `dist/` |
| `npm run db:migrate` | Crea y aplica una migración nueva (interactivo, correr en tu terminal, no en CI) |
| `npm run db:deploy` | Aplica migraciones pendientes sin prompts (CI/producción) |
| `npm run db:seed` | Corre `prisma/seed.ts` |
| `npm run db:studio` | Abre Prisma Studio |
| `npm run db:reset` | Resetea la base y vuelve a correr migraciones + seed |
| `npm run scrape:run` | Corre el sync de promociones (Santander/OCA/Itaú) a mano, sin esperar al cron de las 3am. Pisa las promos de Santander/OCA con datos reales — corré `db:seed` después si querés volver al escenario de demo |
| `npm test` / `npm run test:e2e` | Tests unitarios / e2e |

## Notas técnicas (por si algo no arranca)

- **Prisma 7 usa un driver adapter, no un engine binario.** `PrismaService`
  (`src/infrastructure/prisma/prisma.service.ts`) crea el cliente con
  `@prisma/adapter-pg` sobre `pg`. No hace falta `binaryTargets` ni nada
  parecido.
- **El cliente generado usa imports `.js` sobre archivos `.ts`** (convención
  `nodenext` de Prisma 7). Jest necesita el `moduleNameMapper` que ya está
  configurado en `package.json` y `test/jest-e2e.json` para resolverlos.
- **Prisma 7 compila las queries con un motor WASM que hace `import()`
  dinámico.** Jest no lo soporta sin el flag `--experimental-vm-modules`, por
  eso los scripts `test*` ya lo incluyen vía `cross-env`. Si corrés Jest a
  mano, agregá `NODE_OPTIONS=--experimental-vm-modules`.
- **El build de Nest emite a `dist/src/main.js`, no `dist/main.js`.** Es
  porque `rootDir` de TypeScript termina abarcando `src/`, `prisma/` y
  `generated/` (el cliente generado vive fuera de `src` y se importa desde
  ahí). `start:prod` y el `Dockerfile` ya apuntan al path correcto.
- **No corras código con decoradores de Nest (`@Injectable`, DI) con
  `tsx`.** Su transform basado en esbuild no emite bien
  `design:paramtypes`, así que `Reflect.getMetadata` no encuentra el tipo
  del parámetro y la inyección de dependencias falla en runtime con
  `UndefinedDependencyException` (pasó armando `scrape:run`). `tsx` sí
  sirve para scripts sin DI, como `prisma/seed.ts`. Para todo lo que
  bootstrapea un `AppModule` (scripts sueltos, runners), compilá con
  `nest build` y corré el `.js` de `dist/` — así lo hace `scrape:run`.

## Decisión fuera de la lista literal del spec

El modelo `MerchantChain` tiene `categoryId` (no estaba en la lista de campos
del spec original). Es necesario para poder resolver "necesito una farmacia"
sin que el usuario mencione la cadena — sin ese campo no hay forma de
filtrar cadenas por categoría en `GET /search`.

## Roadmap

- [x] Semana 1 — proyecto, Docker, Postgres, Prisma, modelo de datos, seed
- [~] Semana 2 — scrapers: Santander y OCA reales (cron diario + `scrape:run`), Itaú bloqueado (ver `PLAN.md`)
- [x] Semana 3 — motor de búsqueda, comparación hoy vs. 7 días, sucursales (`GET /search`, `/branches/search`, `/promotions/upcoming`)
- [~] Semana 4 — WhatsApp Cloud API + IA (OpenRouter/GPT-4o) + `/savings`: DONE. Deploy: pendiente

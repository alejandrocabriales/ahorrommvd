# AhorroMVD — Response Playbook

Respuestas objetivo del copiloto conversacional (Semana 4+, capa Response
Generator). Todo lo marcado **[real]** sale tal cual de los datos hoy en la
base local (seed de desarrollo, fecha de referencia **12/08/2026**) — se
puede reproducir corriendo `npm run db:seed` y probando esos mensajes. Lo
marcado **[hipotético]** es un ejemplo de formato con datos inventados a
propósito para ilustrar un caso que no tenemos hoy en la base (nunca se
mostraría así en producción con datos reales).

Regla de fondo en todos los ejemplos: **no responder preguntas, resolver
decisiones** — una recomendación concreta primero, alternativas después,
"¿conviene esperar?" solo si hay data real que lo respalde, y como mucho
una pregunta de cierre.

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

Dato de base: Ta-Ta con Santander 20% hoy (vence mañana), Devoto con OCA 12%
hoy, y Ta-Ta con OCA 40% recién desde mañana.

> Para hacer las compras hoy, la mejor opción es **Ta-Ta con Santander: 20%**.
> También tenés Devoto con OCA al 12% si te queda mejor de camino.
>
> **¿Conviene esperar?** Sí — mañana Ta-Ta tiene 40% con OCA, casi el doble.
> Si las compras no son urgentes, esperar un día conviene bastante.
>
> ¿Querés que te calcule cuánto ahorrarías según lo que pensás gastar?

### "farmacias" / "necesito una farmacia" **[real]**

Dato de base: Farmashop con Itaú 15% hoy, y Farmashop con Santander 25%
recién desde el 15/08 (en 3 días).

> Hoy la única promo activa en farmacias es **Farmashop con Itaú: 15%**.
>
> **¿Conviene esperar?** Si podés esperar 3 días, Farmashop pasa a tener 25%
> con Santander — bastante más. Si es algo urgente, and hoy con Itaú ya está
> bien.
>
> ¿Es algo que podés dejar para el fin de semana, o lo necesitás ya?

---

## Consultas por comercio

### "Ta-Ta" **[real]** — el caso de éxito documentado en `PLAN.md`

Dato de base: Santander 20% hoy (vence mañana), Itaú 10% hoy, OCA 40% desde
mañana.

> Hoy en Ta-Ta te conviene pagar con **Santander: 20%**.
>
> **¿Conviene esperar?** Sí — mañana Ta-Ta tiene 40% con OCA, el doble de
> hoy. Si tu compra no es urgente, esperar un día puede duplicar tu ahorro.
>
> ¿Querés que te calcule cuánto ahorrarías exacto según el monto?

Con monto (ej. usuario escribió "Ta-Ta 4000"): `estimatedSavingToday` trae
`{amount: 800, cappedByBank: false}` desde el backend, y ahí sí el Response
Generator puede decir el número real:

> Hoy en Ta-Ta con Santander ahorrás 20% — sobre $4.000 son aproximadamente
> **$800**. Mañana, con el 40% de OCA, serían cerca de $1.600: casi el doble.
> Si podés esperar un día, conviene.

### "Farmashop" **[real]**

> Hoy en Farmashop te conviene pagar con **Itaú: 15%**. En 3 días pasa a 25%
> con Santander — si podés esperar, ahí ahorrás bastante más.
>
> ¿Te sirve para algo de hoy o podés esperar al fin de semana?

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
el usuario menciona **nunca filtra resultados ni afirma cercanía real** —
como mucho, si hay una sucursal cargada que coincide, se la nombra.

### "Pocitos" **[real — hay sucursales cargadas]**

Base: Ta-Ta Pocitos y Farmashop Pocitos existen como sucursales reales.

> En Pocitos tenés Ta-Ta (Santander 20% hoy, 40% con OCA mañana) y Farmashop
> (Itaú 15% hoy). Si vas al súper, Ta-Ta hoy con Santander es lo mejor;
> mañana conviene más todavía.
>
> ¿Buscás algo puntual (súper, farmacia) o querés las dos opciones?

### "Punta Carretas" **[real]**

Base: Devoto Punta Carretas, Ta-Ta Punta Carretas, McDonald's Punta Carretas
Shopping.

> En Punta Carretas tenés Ta-Ta (20% Santander hoy) y Devoto (12% OCA hoy) para
> el súper, y McDonald's con 30% OCA a partir del jueves si podés esperar.
>
> ¿Vas al súper ahora o preguntás por comida?

### "Centro" **[real, parcial]**

Base: Farmashop Centro existe como sucursal.

> En Centro tengo cargada la Farmashop, con 15% Itaú hoy (25% Santander en 3
> días si podés esperar). No tengo otras sucursales de esa zona en la base
> todavía, pero te puedo mostrar opciones de cadena completa si querés.
>
> ¿Buscás algo puntual o te muestro todas las opciones de hoy igual?

### "Cordón" / "Carrasco" **[hipotético — sin sucursales cargadas]**

No hay ninguna sucursal con esos barrios en la base hoy. El bot **no debe
inventar que hay algo cerca** — cae directo al listado general (las
promociones de cadena completa aplican en cualquier sucursal, así que
igual son útiles, solo que sin la mención de "cerca tuyo"):

> No tengo sucursales cargadas en Cordón todavía, pero estas promos aplican
> en cualquier local de la cadena: hoy Ta-Ta con Santander 20% es lo mejor
> para el súper.
>
> ¿Te sirve así o preferís que te avise cuando carguemos direcciones de esa zona?

---

## Consultas abiertas

Estas messages no nombran comercio ni categoría — el intent parser las
marca con `wantsGeneralSavings: true` y el Recommendation Engine mira las 3
categorías del MVP juntas (`BrowseByCategoryUseCase.execute(null, zone,
userId)`), trayendo la mejor oferta de **todo** Montevideo hoy.

### "quiero ahorrar hoy" **[real]**

Con los datos de base (mejor de las 3 categorías = Ta-Ta Santander 20%):

> Hoy lo que más te conviene es ir al súper: **Ta-Ta con Santander, 20%**.
> Como alternativa, Devoto tiene 12% con OCA y Farmashop 15% con Itaú si
> necesitás algo de farmacia.
>
> **¿Conviene esperar?** Si podés estirar el súper un día, mañana Ta-Ta pasa
> a 40% con OCA — el doble.
>
> ¿Te interesa el súper, la farmacia, o querés que te calcule un monto?

### "qué me conviene hacer" **[real — mismo motor que arriba]**

> Ahora mismo, lo mejor que podés hacer para ahorrar es el súper en Ta-Ta con
> Santander (20%). Si podés esperar a mañana, sube a 40% con OCA.
>
> ¿Querés que te muestre farmacias o restaurantes también?

### "tengo que hacer el súper" **[real — mapea a categoryName: Supermercados]**

Mismo resultado que la sección "supermercados" de arriba — el intent parser
lo resuelve directo a categoría, no pasa por `wantsGeneralSavings`.

### "quiero salir a comer" **[real — mapea a categoryName: Restaurantes]**

Mismo resultado que la sección "restaurantes" de arriba.

---

## Casos límite ya cubiertos por el flujo (no específicos del Response Generator)

- **Usuario sin tarjetas conocidas**: el bot pregunta ANTES de responder
  ("¿Qué tarjetas tenés?") y retoma la consulta apenas contesta — ver
  `HandleWhatsAppMessageUseCase`. No es parte de este playbook porque no
  pasa por el Response Generator todavía en ese primer mensaje.
- **"dame todas las ofertas"**: ignora el filtro de banco para esa
  respuesta puntual, sin tocar los bancos guardados.
- **Nada vigente ni hoy ni en 7 días**: mensaje fijo, determinístico, sin
  pasar por IA — no hay nada real que redactar (`nothingFound: true`).

## Lo que este playbook NO promete (limitación de datos, no de diseño)

- **Ubicación automática por GPS**: no implementado. El backend no recibe
  coordenadas del usuario — todo lo que el bot sabe de "dónde estás" es lo
  que el usuario escribe como texto (zona), y ni así filtra resultados.
- **"Sucursal más cercana" real**: requiere lat/long en `branches`, que hoy
  no existe para ninguna fila. Es un proyecto de datos (backfill de
  direcciones), no de este Response Generator.

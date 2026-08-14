import { GeoPoint } from './geo-point';

/**
 * Centroides de los barrios de Montevideo, resueltos una sola vez con la
 * Places API y guardados acá como dato fijo.
 *
 * Existe porque el geocoding en vivo es el único paso del flujo de
 * recomendación que depende de una API externa por mensaje, y cuando falla
 * se cae TODO lo que el usuario pidió: sin punto de zona no hay filtro de
 * distancia, no se elige sucursal, y la respuesta sale sin dirección. Pasó
 * en producción (14/8): el usuario preguntó por Pocitos, el contexto quedó
 * guardado con `zone: "Pocitos"` y `address: null`.
 *
 * Un barrio no se muda: cachearlo en código es más honesto que pegarle a
 * Google por cada mensaje, y además sale gratis. Places sigue estando para
 * lo que no esté en esta lista (una calle, una esquina, un barrio nuevo).
 */
interface Neighborhood {
  name: string;
  point: GeoPoint;
}

function at(name: string, latitude: number, longitude: number): Neighborhood {
  return { name, point: { latitude, longitude } };
}

export const MONTEVIDEO_NEIGHBORHOODS: readonly Neighborhood[] = [
  at('Aguada', -34.8835, -56.19068),
  at('Aires Puros', -34.85387, -56.18958),
  at('Atahualpa', -34.86688, -56.18818),
  at('Bañados de Carrasco', -34.85959, -56.07049),
  at('Barrio Sur', -34.91088, -56.18818),
  at('Belvedere', -34.84908, -56.22333),
  at('Bella Italia', -34.83271, -56.11841),
  at('Bella Vista', -34.87694, -56.20075),
  at('Brazo Oriental', -34.86503, -56.17841),
  at('Buceo', -34.89928, -56.12295),
  at('Capurro', -34.87075, -56.21611),
  at('Carrasco', -34.88501, -56.05566),
  at('Carrasco Norte', -34.87387, -56.06681),
  at('Casabó', -34.88504, -56.27337),
  at('Casavalle', -34.82087, -56.16903),
  at('Centro', -34.90452, -56.19516),
  at('Cerrito de la Victoria', -34.85349, -56.17283),
  at('Cerro', -34.88306, -56.25622),
  at('Ciudad Vieja', -34.90803, -56.20633),
  at('Colón', -34.80455, -56.22283),
  at('Conciliación', -34.82307, -56.23566),
  at('Cordón', -34.90414, -56.17841),
  at('Flor de Maroñas', -34.84923, -56.12817),
  at('Ituzaingó', -34.84795, -56.14352),
  at('Jacinto Vera', -34.87384, -56.17143),
  at('Jardines del Hipódromo', -34.83631, -56.13345),
  at('La Blanqueada', -34.88202, -56.15257),
  at('La Comercial', -34.88763, -56.16864),
  at('La Figurita', -34.88034, -56.1725),
  at('La Paloma', -34.86197, -56.2622),
  at('La Teja', -34.86506, -56.23154),
  at('Larrañaga', -34.87932, -56.16166),
  at('Las Acacias', -34.83845, -56.15608),
  at('Lezica', -34.79634, -56.24803),
  at('Malvín', -34.89107, -56.10586),
  at('Malvín Norte', -34.87993, -56.11702),
  at('Manga', -34.80696, -56.14152),
  at('Maroñas', -34.86214, -56.12464),
  at('Mercado Modelo', -34.86779, -56.15608),
  at('Nuevo París', -34.84167, -56.24374),
  at('Palermo', -34.91069, -56.17981),
  at('Parque Batlle', -34.89577, -56.14752),
  at('Parque Rodó', -34.9128, -56.16515),
  at('Paso de la Arena', -34.81825, -56.30944),
  at('Paso de las Duranas', -34.84768, -56.20493),
  // Corregido a mano: Places resuelve "Peñarol Montevideo" al Palacio
  // Peñarol (el estadio, en Centro), no al barrio del norte.
  at('Peñarol', -34.8195, -56.2047),
  at('Piedras Blancas', -34.82425, -56.1408),
  at('Pocitos', -34.90853, -56.15041),
  at('Prado', -34.85913, -56.20633),
  at('Punta Carretas', -34.92155, -56.15608),
  at('Punta Gorda', -34.89598, -56.08058),
  at('Reducto', -34.87832, -56.18958),
  at('Sayago', -34.83642, -56.21192),
  at('Tres Cruces', -34.89496, -56.16864),
  at('Tres Ombúes', -34.85986, -56.23985),
  at('Unión', -34.87693, -56.1423),
  at('Villa Dolores', -34.89577, -56.14752),
  at('Villa Española', -34.86428, -56.14492),
  at('Villa García', -34.78051, -56.06753),
  at('Villa Muñoz', -34.88781, -56.17701),
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Un prefijo más corto que esto no identifica un barrio ("la", "vi"). */
const MIN_PREFIX_LENGTH = 4;

/**
 * Resuelve el barrio a coordenadas sin salir de este archivo. Tolera cómo
 * se escribe en un WhatsApp real: sin tilde, en minúscula, o incompleto
 * ("pocito" -> Pocitos, caso real del 14/8).
 *
 * Si el prefijo matchea más de un barrio ("villa", "carrasco norte" vs
 * "carrasco") devuelve null en vez de elegir: mejor que decida Places, que
 * ve el texto completo, a que mandemos al usuario al barrio equivocado.
 */
export function findMontevideoNeighborhood(zone: string): GeoPoint | null {
  const target = normalize(zone);
  if (target.length === 0) return null;

  const exact = MONTEVIDEO_NEIGHBORHOODS.find(
    (n) => normalize(n.name) === target,
  );
  if (exact) return exact.point;

  if (target.length < MIN_PREFIX_LENGTH) return null;
  const byPrefix = MONTEVIDEO_NEIGHBORHOODS.filter((n) => {
    const name = normalize(n.name);
    return name.startsWith(target) || target.startsWith(name);
  });
  return byPrefix.length === 1 ? byPrefix[0].point : null;
}

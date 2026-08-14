/**
 * ¿El nombre que devolvió Google es esta cadena, o solo un negocio que se le
 * parece? Único criterio de nombre del backfill de sucursales.
 *
 * Antes era `normalize(displayName).startsWith(normalize(chainName))`, y eso
 * descartaba resultados correctos por el prefijo que Google le pone al
 * comercio: la cadena "Facal" existe en Google como "Bar Facal" (Montevideo,
 * tipo `bar`) y se perdía entera. Con 86 de 127 cadenas de Restaurantes sin
 * sucursal, parte de ese agujero era esto, no cadenas inexistentes.
 *
 * Ahora: se sacan las palabras de rubro del ARRANQUE de los dos nombres
 * ("Bar Facal" -> "Facal") y recién ahí se exige que la cadena sea prefijo
 * del lugar. Prefijo y no "aparece en cualquier lado" porque el nombre de
 * la cadena al final suele ser el barrio y no la marca: "TALCAFÉ SOHO" es
 * un café del barrio Soho, no la cadena "Soho" (caso real de la Places
 * API, igual que "Puesta del Sol" contra "Café del Sol").
 */
const GENERIC_WORDS = new Set([
  'bar',
  'cafe',
  'cafeteria',
  'coffee',
  'resto',
  'restobar',
  'restaurant',
  'restaurante',
  'parrilla',
  'pizzeria',
  'heladeria',
  'panaderia',
  'pub',
  'shop',
  'store',
  'local',
  'sucursal',
  'farmacia',
  'supermercado',
  'the',
  'la',
  'el',
  'los',
  'las',
  'de',
  'del',
  'y',
]);

/**
 * Mínimo de letras "propias" (sin contar palabras genéricas) que tiene que
 * aportar el nombre de la cadena para confiar en el match. Sin esto, una
 * cadena llamada "Bar" o "Sol" matchearía media Montevideo.
 */
const MIN_DISTINCTIVE_LENGTH = 4;

function tokenize(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Saca las palabras de rubro del arranque: "Bar Facal" -> ["facal"]. Solo del arranque: "Café Butiá" no puede quedar en nada. */
function dropLeadingGenerics(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length - 1 && GENERIC_WORDS.has(tokens[start])) {
    start++;
  }
  return tokens.slice(start);
}

function isPrefix(tokens: string[], prefix: string[]): boolean {
  return (
    prefix.length <= tokens.length &&
    prefix.every((token, i) => tokens[i] === token)
  );
}

export function matchesChainName(
  displayName: string,
  chainName: string,
): boolean {
  const chainTokens = dropLeadingGenerics(tokenize(chainName));
  const placeTokens = dropLeadingGenerics(tokenize(displayName));
  if (chainTokens.length === 0 || placeTokens.length === 0) return false;
  if (!isPrefix(placeTokens, chainTokens)) return false;

  const distinctive = chainTokens
    .filter((token) => !GENERIC_WORDS.has(token))
    .join('');
  if (distinctive.length >= MIN_DISTINCTIVE_LENGTH) return true;

  // Nombre corto o casi todo genérico ("Su Bar"): aceptamos solo el nombre
  // idéntico, sin el "+ local" que sí le permitimos a una marca distintiva.
  // Si no, "Bar" se llevaría puesto cualquier bar de Montevideo.
  return placeTokens.length === chainTokens.length;
}

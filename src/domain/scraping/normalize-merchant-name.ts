/**
 * Normaliza un nombre de comercio para comparar tolerando acentos, guiones,
 * espacios y mayúsculas: "TaTa" === "Ta-Ta" === "tata". Usado tanto para
 * matchear nombres scrapeados contra `MerchantChain` (Semana 2) como para
 * validar que un resultado de Google Places corresponde de verdad a la
 * cadena buscada (backfill de sucursales) — mismo criterio en los dos
 * lugares, no dos heurísticas de "se parece" distintas.
 */
export function normalizeMerchantName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

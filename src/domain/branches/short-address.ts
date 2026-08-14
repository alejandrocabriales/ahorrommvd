/**
 * La dirección que guarda el backfill es el `formattedAddress` crudo de
 * Google: "Plaza de Comidas, Av. Luis Alberto de Herrera 1290, 11300
 * Montevideo, Departamento de Montevideo, Uruguay". En un mensaje de
 * WhatsApp de un producto que solo cubre Montevideo, todo lo que va después
 * de la calle es ruido — y encima empuja al Response Generator a repetirlo.
 *
 * Se recorta al mostrar, no al guardar: en la base queda la dirección
 * completa tal como la devolvió Google, que es la fuente.
 */
const NOISE_SEGMENT =
  /^(uruguay|departamento de montevideo|\d{4,5}\s+montevideo|montevideo)$/i;

export function shortAddress(address: string | null): string | null {
  if (!address) return null;
  const kept = address
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !NOISE_SEGMENT.test(part));

  // Si de recortar no queda nada (una dirección que era solo "Montevideo,
  // Uruguay"), devolvemos la original: mejor larga que vacía.
  return kept.length > 0 ? kept.join(', ') : address;
}

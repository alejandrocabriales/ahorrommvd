import { distanceKm } from './distance';
import {
  findMontevideoNeighborhood,
  MONTEVIDEO_NEIGHBORHOODS,
} from './montevideo-neighborhoods';

describe('findMontevideoNeighborhood', () => {
  it('resuelve el barrio escrito tal cual', () => {
    expect(findMontevideoNeighborhood('Pocitos')).toEqual({
      latitude: -34.90853,
      longitude: -56.15041,
    });
  });

  it('tolera minúsculas, tildes faltantes e incompleto ("pocito", caso real del 14/8)', () => {
    const pocitos = findMontevideoNeighborhood('Pocitos');
    expect(findMontevideoNeighborhood('pocito')).toEqual(pocitos);
    expect(findMontevideoNeighborhood('malvin')).toEqual(
      findMontevideoNeighborhood('Malvín'),
    );
    expect(findMontevideoNeighborhood('CIUDAD VIEJA')).toEqual(
      findMontevideoNeighborhood('Ciudad Vieja'),
    );
  });

  it('no elige cuando el prefijo es ambiguo — que decida Places con el texto completo', () => {
    expect(findMontevideoNeighborhood('villa')).toBeNull();
    // "malvin" solo matchea Malvín exacto; "malv" matchea Malvín y Malvín Norte.
    expect(findMontevideoNeighborhood('malv')).toBeNull();
  });

  it('devuelve null para lo que no es un barrio, para que siga el geocoding real', () => {
    expect(findMontevideoNeighborhood('Av. Brasil 2846')).toBeNull();
    expect(findMontevideoNeighborhood('Punta del Este')).toBeNull();
    expect(findMontevideoNeighborhood('')).toBeNull();
  });

  it('todos los barrios caen dentro de Montevideo (~20km del centro)', () => {
    const center = { latitude: -34.9011, longitude: -56.1645 };
    for (const barrio of MONTEVIDEO_NEIGHBORHOODS) {
      expect(distanceKm(center, barrio.point)).toBeLessThan(20);
    }
  });

  it('barrios vecinos quedan separados de verdad (si dos colapsan, el filtro de cercanía miente)', () => {
    const pocitos = findMontevideoNeighborhood('Pocitos')!;
    const buceo = findMontevideoNeighborhood('Buceo')!;
    const cerro = findMontevideoNeighborhood('Cerro')!;
    expect(distanceKm(pocitos, buceo)).toBeGreaterThan(1);
    expect(distanceKm(pocitos, cerro)).toBeGreaterThan(8);
  });
});

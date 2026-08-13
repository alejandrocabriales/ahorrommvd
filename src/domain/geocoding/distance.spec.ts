import { distanceKm } from './distance';

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm({ latitude: -34.9, longitude: -56.16 }, { latitude: -34.9, longitude: -56.16 })).toBeCloseTo(0, 5);
  });

  it('matches the real distance between Barrio Sur and Pocitos (~3.5km, different barrios)', () => {
    const barrioSur = { latitude: -34.9108776, longitude: -56.1881819 };
    const pocitos = { latitude: -34.9085301, longitude: -56.1504057 };

    expect(distanceKm(barrioSur, pocitos)).toBeGreaterThan(3);
    expect(distanceKm(barrioSur, pocitos)).toBeLessThan(4);
  });
});

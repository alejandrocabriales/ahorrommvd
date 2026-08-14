import { GooglePlacesZoneGeocoder } from './google-places-zone-geocoder';
import { MontevideoZoneGeocoder } from './montevideo-zone.geocoder';

function fakePlaces(
  impl: jest.Mock = jest.fn().mockResolvedValue(null),
): GooglePlacesZoneGeocoder {
  return { geocode: impl } as unknown as GooglePlacesZoneGeocoder;
}

describe('MontevideoZoneGeocoder', () => {
  it('resuelve un barrio conocido sin llamar a Places', async () => {
    const places = jest.fn();
    const geocoder = new MontevideoZoneGeocoder(fakePlaces(places));

    const point = await geocoder.geocode('pocito');

    expect(point).toEqual({ latitude: -34.90853, longitude: -56.15041 });
    expect(places).not.toHaveBeenCalled();
  });

  it('delega en Places lo que no es un barrio de la lista', async () => {
    const places = jest
      .fn()
      .mockResolvedValue({ latitude: -34.9, longitude: -56.16 });
    const geocoder = new MontevideoZoneGeocoder(fakePlaces(places));

    const point = await geocoder.geocode('Av. Brasil 2846');

    expect(places).toHaveBeenCalledWith('Av. Brasil 2846');
    expect(point).toEqual({ latitude: -34.9, longitude: -56.16 });
  });

  it('un fallo de Places devuelve null en vez de romper la consulta', async () => {
    const places = jest.fn().mockRejectedValue(new Error('sin API key'));
    const geocoder = new MontevideoZoneGeocoder(fakePlaces(places));

    await expect(geocoder.geocode('una calle rara')).resolves.toBeNull();
  });

  it('un fallo de Places no afecta a un barrio conocido — ahí ni se lo consulta', async () => {
    const places = jest.fn().mockRejectedValue(new Error('sin API key'));
    const geocoder = new MontevideoZoneGeocoder(fakePlaces(places));

    await expect(geocoder.geocode('Buceo')).resolves.toEqual({
      latitude: -34.89928,
      longitude: -56.12295,
    });
  });
});

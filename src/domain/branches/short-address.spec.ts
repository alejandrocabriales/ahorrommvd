import { shortAddress } from './short-address';

describe('shortAddress', () => {
  it('saca departamento, país y código postal de una dirección real de Places', () => {
    expect(
      shortAddress(
        'Plaza de Comidas, Av. Luis Alberto de Herrera 1290, 11300 Montevideo, Departamento de Montevideo, Uruguay',
      ),
    ).toBe('Plaza de Comidas, Av. Luis Alberto de Herrera 1290');
  });

  it('deja intacta una dirección que ya es corta (las del seed)', () => {
    expect(shortAddress('Av. Brasil 2846')).toBe('Av. Brasil 2846');
  });

  it('no devuelve vacío cuando la dirección era solo ciudad y país', () => {
    expect(shortAddress('Montevideo, Uruguay')).toBe('Montevideo, Uruguay');
  });

  it('propaga null', () => {
    expect(shortAddress(null)).toBeNull();
  });
});

import {
  USER_NEEDS,
  categoriesForNeed,
  isNeedCovered,
  needLabel,
} from './user-need';

describe('UserNeed', () => {
  it('separa comida hecha de hacer la compra — son necesidades distintas aunque las dos sean comida', () => {
    expect(categoriesForNeed('prepared_food')).toEqual(['Restaurantes']);
    expect(categoriesForNeed('grocery')).toEqual(['Supermercados']);
  });

  it('resuelve una necesidad en más de una categoría cuando el producto se consigue en las dos', () => {
    // Shampoo, detergente, pañales: están tanto en el súper como en la
    // farmacia. Quedarnos con una sola sería descartar promos reales por una
    // decisión de taxonomía nuestra.
    expect(categoriesForNeed('household')).toEqual([
      'Supermercados',
      'Farmacias',
    ]);
  });

  it('marca como no cubiertas las necesidades que entendemos pero no podemos responder', () => {
    expect(isNeedCovered('shopping')).toBe(false);
    expect(isNeedCovered('fuel')).toBe(false);
    expect(isNeedCovered('services')).toBe(false);
    expect(categoriesForNeed('shopping')).toEqual([]);
  });

  it('cubre las necesidades para las que sí tenemos comercios y promos', () => {
    expect(isNeedCovered('prepared_food')).toBe(true);
    expect(isNeedCovered('grocery')).toBe(true);
    expect(isNeedCovered('household')).toBe(true);
    expect(isNeedCovered('pharmacy')).toBe(true);
  });

  it('tiene un mapeo y una etiqueta para cada necesidad — ninguna puede quedar sin definir', () => {
    for (const need of USER_NEEDS) {
      expect(Array.isArray(categoriesForNeed(need))).toBe(true);
      expect(needLabel(need).length).toBeGreaterThan(0);
    }
  });
});

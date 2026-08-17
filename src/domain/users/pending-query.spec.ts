import { normalizePendingQuery } from './pending-query';

describe('normalizePendingQuery', () => {
  it('deja pasar una consulta ya guardada con la forma actual', () => {
    const query = {
      merchantName: null,
      branchHint: null,
      need: 'grocery',
      items: ['arroz', 'tomate'],
      zone: 'Pocitos',
      amount: 600,
      wantsGeneralSavings: false,
    };

    expect(normalizePendingQuery(query)).toEqual(query);
  });

  it('entiende una fila guardada antes de que existiera UserNeed (categoryName, sin items)', () => {
    // `pendingQuery` vive como JSON en la base: cuando salió este cambio,
    // las filas en curso tenían la forma vieja. Normalizarlas en la lectura
    // evita que un usuario a mitad de conversación pierda el hilo.
    expect(
      normalizePendingQuery({
        merchantName: null,
        branchHint: null,
        categoryName: 'Supermercados',
        zone: 'Pocitos',
        amount: null,
        wantsGeneralSavings: false,
      }),
    ).toEqual({
      merchantName: null,
      branchHint: null,
      need: 'grocery',
      items: [],
      zone: 'Pocitos',
      amount: null,
      wantsGeneralSavings: false,
    });
  });

  it('traduce las 3 categorías viejas a su necesidad', () => {
    const needOf = (categoryName: string) =>
      normalizePendingQuery({ categoryName })?.need;

    expect(needOf('Supermercados')).toBe('grocery');
    expect(needOf('Farmacias')).toBe('pharmacy');
    expect(needOf('Restaurantes')).toBe('prepared_food');
  });

  it('descarta un need desconocido en vez de propagarlo', () => {
    // Si mañana sacamos una necesidad del enum, una fila vieja con ese valor
    // no puede terminar en `categoriesForNeed(undefined)`.
    expect(normalizePendingQuery({ need: 'teletransportacion' })?.need).toBe(
      null,
    );
  });

  it('se banca items que no son un array de strings', () => {
    expect(
      normalizePendingQuery({ need: 'grocery', items: null })?.items,
    ).toEqual([]);
    expect(
      normalizePendingQuery({ need: 'grocery', items: ['arroz', 3] })?.items,
    ).toEqual(['arroz']);
  });

  it('devuelve null cuando no hay nada guardado', () => {
    expect(normalizePendingQuery(null)).toBe(null);
    expect(normalizePendingQuery(undefined)).toBe(null);
  });
});

import { matchesChainName } from './matches-chain-name';

describe('matchesChainName', () => {
  it('acepta el prefijo de rubro que le pone Google al nombre real', () => {
    // Caso que motivó el cambio: "Facal" existía en Places como "Bar Facal",
    // en Montevideo y con tipo `bar`, y el match por prefijo lo descartaba.
    expect(matchesChainName('Bar Facal', 'Facal')).toBe(true);
    expect(matchesChainName('Restaurante Oscar', 'Oscar')).toBe(true);
    expect(matchesChainName('Pizzería Bardo', 'Bardo')).toBe(true);
  });

  it('sigue aceptando la sucursal nombrada como "marca + local"', () => {
    expect(
      matchesChainName("McDonald's Punta Carretas Shopping", "McDonald's"),
    ).toBe(true);
    expect(matchesChainName('Ta-Ta Pocitos', 'Ta-Ta')).toBe(true);
  });

  it('tolera acentos, guiones y mayúsculas', () => {
    expect(matchesChainName('Cafe Butia', 'Café Butiá')).toBe(true);
    expect(matchesChainName('TA-TA HIPER CERRO', 'Ta-Ta')).toBe(true);
  });

  it('rechaza el comercio que lleva el nombre de la cadena al final, que suele ser el barrio', () => {
    // Real: buscando "Soho", Places devuelve un café del barrio Soho.
    expect(matchesChainName('TALCAFÉ SOHO', 'Soho')).toBe(false);
    expect(matchesChainName('Pizza Lolo', 'Lolo')).toBe(false);
  });

  it('rechaza comercios que solo comparten palabras sueltas', () => {
    // Real: buscando "Cafe del Sol", Places devolvió estos dos.
    expect(matchesChainName('Puesta del Sol', 'Cafe del Sol')).toBe(false);
    expect(matchesChainName('Sol Cafe', 'Cafe del Sol')).toBe(false);
  });

  it('rechaza cuando los tokens de la cadena no están seguidos', () => {
    expect(matchesChainName('La Rural del Prado', 'La Rural Prado')).toBe(
      false,
    );
  });

  it('rechaza nombres sin parte distintiva propia', () => {
    // Una cadena que después de sacar palabras de rubro no aporta nada
    // matchearía media ciudad.
    expect(matchesChainName('Bar Tabaré', 'Bar')).toBe(false);
    expect(matchesChainName('Cafetería del Centro', 'Café')).toBe(false);
  });

  it('no matchea un comercio distinto que empieza igual', () => {
    expect(matchesChainName('Papiros', 'Papirosen')).toBe(false);
    expect(matchesChainName('Nona Bianca', 'Nona')).toBe(true); // sí: mismo nombre + local
  });
});

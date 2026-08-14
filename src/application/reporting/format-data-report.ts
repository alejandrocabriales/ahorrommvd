import { DataReport } from './data-report';

/**
 * Formatea el reporte como texto para la consola. Va separado del use case
 * para poder testear los números sin parsear tablas, y las tablas sin tocar
 * la base.
 */
export function formatDataReport(report: DataReport): string {
  const lines: string[] = [
    `Reporte de datos — ${report.generatedAt.toLocaleString('es-UY')}`,
    '',
    'COBERTURA POR CATEGORÍA',
    table(
      [
        'categoría',
        'cadenas',
        'c/sucursal',
        'sucursales',
        'promos hoy',
        'recomendables',
      ],
      report.categories.map((c) => [
        c.categoryName,
        c.chains,
        c.chainsWithBranches,
        c.branches,
        c.activePromotions,
        c.recommendablePromotions,
      ]),
    ),
    '',
    'PROMOS VIGENTES HOY POR BANCO × CATEGORÍA',
    table(
      ['banco', 'categoría', 'vigentes', 'recomendables'],
      report.bankCategories.map((c) => [
        c.bankName,
        c.categoryName,
        c.activePromotions,
        c.recommendablePromotions,
      ]),
    ),
  ];

  const withoutBranches = report.categories.filter(
    (c) => c.chainsWithoutBranchesSamples.length > 0,
  );
  if (withoutBranches.length > 0) {
    lines.push('', 'CADENAS SIN SUCURSAL VERIFICADA (muestra)');
    for (const category of withoutBranches) {
      const missing = category.chains - category.chainsWithBranches;
      lines.push(
        `  ${category.categoryName} (${missing}): ${category.chainsWithoutBranchesSamples.join(', ')}${missing > category.chainsWithoutBranchesSamples.length ? ', …' : ''}`,
      );
    }
  }

  if (report.ingestion) {
    lines.push(
      '',
      'EMBUDO DE INGESTA (scrapers en seco, sin escribir en la base)',
      table(
        ['banco', 'scrapeadas', 'matchean', 'auto-crean', 'se pierden'],
        report.ingestion.map((i) => [
          i.bankName,
          i.error ? '—' : i.scraped,
          i.error ? '—' : i.matchedExistingChain,
          i.error ? '—' : i.autoCreatableChain,
          i.error ? '—' : i.dropped,
        ]),
      ),
    );
    for (const bank of report.ingestion) {
      if (bank.error) {
        lines.push(`  ${bank.bankName}: ERROR — ${bank.error}`);
      } else if (bank.droppedSamples.length > 0) {
        lines.push(
          `  ${bank.bankName} se pierde: ${bank.droppedSamples.join(', ')}${bank.dropped > bank.droppedSamples.length ? ', …' : ''}`,
        );
      }
    }
  }

  return lines.join('\n');
}

/** Tabla de ancho fijo por columna: números a la derecha, texto a la izquierda. */
function table(headers: string[], rows: Array<Array<string | number>>): string {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) =>
    Math.max(...all.map((row) => row[i].length)),
  );
  const render = (row: Array<string | number>) =>
    '  ' +
    row
      .map((cell, i) =>
        typeof cell === 'number'
          ? String(cell).padStart(widths[i])
          : String(cell).padEnd(widths[i]),
      )
      .join('  ')
      .trimEnd();

  return [
    render(headers),
    '  ' + widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(render),
  ].join('\n');
}

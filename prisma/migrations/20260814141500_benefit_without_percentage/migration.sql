-- Beneficios que no son un porcentaje (ej. el 2x1 de Freddo y Las Delicias
-- en el feed de Itaú): la promo es real y tiene locales en Montevideo, pero
-- no hay un % que guardar. Antes se descartaban en el scraper, que es la
-- razón por la que un usuario Itaú preguntando dónde comer no recibía nada.
--
-- discount_percentage pasa a ser opcional y benefit_label guarda el texto
-- tal cual lo publica el banco ("2x1 en helados de litro y cucuruchos
-- grandes"). Una fila tiene uno u otro, nunca los dos vacíos.
ALTER TABLE "promotions" ALTER COLUMN "discount_percentage" DROP NOT NULL;
ALTER TABLE "promotions" ADD COLUMN "benefit_label" TEXT;

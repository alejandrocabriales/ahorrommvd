/**
 * Seed de desarrollo local.
 *
 * IMPORTANTE: los porcentajes de descuento acá son ILUSTRATIVOS, no promociones
 * reales verificadas. A partir de Semana 2 los scrapers (Itaú, Santander, OCA)
 * reemplazan estos datos por promociones reales tomadas de las páginas oficiales.
 * Este seed solo existe para poder desarrollar y probar el motor de búsqueda,
 * la comparación hoy-vs-7-días y el flujo de sucursales sin depender de los
 * scrapers todavía.
 */
import { PrismaClient, PaymentType } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const today = new Date();

async function upsertBank(name: string) {
  return prisma.bank.upsert({ where: { name }, update: {}, create: { name } });
}

async function upsertCategory(name: string) {
  return prisma.category.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function upsertChain(name: string, categoryId: string) {
  return prisma.merchantChain.upsert({
    where: { name },
    update: { categoryId },
    create: { name, categoryId },
  });
}

async function upsertBranch(params: {
  merchantChainId: string;
  name: string;
  address?: string;
  neighborhood?: string;
  format?: string;
}) {
  return prisma.branch.upsert({
    where: {
      merchantChainId_name: {
        merchantChainId: params.merchantChainId,
        name: params.name,
      },
    },
    update: params,
    create: params,
  });
}

async function main() {
  const [itau, santander, oca] = await Promise.all([
    upsertBank('Itaú'),
    upsertBank('Santander'),
    upsertBank('OCA'),
  ]);

  const [supermercados, farmacias, restaurantes] = await Promise.all([
    upsertCategory('Supermercados'),
    upsertCategory('Farmacias'),
    upsertCategory('Restaurantes'),
  ]);

  const tata = await upsertChain('Ta-Ta', supermercados.id);
  const devoto = await upsertChain('Devoto', supermercados.id);
  const farmashop = await upsertChain('Farmashop', farmacias.id);
  const mcdonalds = await upsertChain("McDonald's", restaurantes.id);

  const tataPocitos = await upsertBranch({
    merchantChainId: tata.id,
    name: 'Ta-Ta Pocitos',
    address: 'Av. Brasil 2846',
    neighborhood: 'Pocitos',
    format: 'Express',
  });
  const tataPuntaCarretas = await upsertBranch({
    merchantChainId: tata.id,
    name: 'Ta-Ta Punta Carretas',
    address: 'Ellauri 1250',
    neighborhood: 'Punta Carretas',
    format: 'Supermercado',
  });
  const tataTresCruces = await upsertBranch({
    merchantChainId: tata.id,
    name: 'Ta-Ta Tres Cruces',
    address: 'Bulevar Artigas 1825',
    neighborhood: 'Tres Cruces',
    format: 'Supermercado',
  });
  const tataCerro = await upsertBranch({
    merchantChainId: tata.id,
    name: 'Ta-Ta Hiper Cerro',
    address: 'Grecia 3856',
    neighborhood: 'Cerro',
    format: 'Hiper',
  });

  const devotoPuntaCarretas = await upsertBranch({
    merchantChainId: devoto.id,
    name: 'Devoto Punta Carretas',
    address: 'Ellauri 1500',
    neighborhood: 'Punta Carretas',
    format: 'Supermercado',
  });

  const farmashopPocitos = await upsertBranch({
    merchantChainId: farmashop.id,
    name: 'Farmashop Pocitos',
    address: '21 de Setiembre 2900',
    neighborhood: 'Pocitos',
    format: 'Farmacia',
  });
  const farmashopCentro = await upsertBranch({
    merchantChainId: farmashop.id,
    name: 'Farmashop Centro',
    address: '18 de Julio 1200',
    neighborhood: 'Centro',
    format: 'Farmacia',
  });

  const mcdonaldsPuntaCarretas = await upsertBranch({
    merchantChainId: mcdonalds.id,
    name: "McDonald's Punta Carretas Shopping",
    address: 'Ellauri 1350',
    neighborhood: 'Punta Carretas',
    format: 'Local en shopping',
  });

  // Las promociones se re-generan en cada corrida del seed (en producción las
  // reescriben los scrapers diariamente, así que no tiene sentido "upsertear"
  // acá con una clave natural artificial).
  await prisma.promotionBranch.deleteMany({});
  await prisma.promotion.deleteMany({});

  const sourceUrls = {
    itau: 'https://www.itau.com.uy/promociones',
    santander: 'https://www.santander.com.uy/promociones',
    oca: 'https://www.oca.com.uy/promociones',
  };

  // --- Escenario diferenciador (spec): hoy conviene Santander en Ta-Ta Pocitos,
  // pero mañana OCA da mucho más ahí mismo -> vale la pena esperar. ---
  const tataPocitosSantanderHoy = await prisma.promotion.create({
    data: {
      bankId: santander.id,
      merchantChainId: tata.id,
      discountPercentage: 20,
      paymentType: PaymentType.CREDITO,
      cardName: 'Santander Free',
      capAmount: 1500,
      validFrom: startOfDay(today),
      validUntil: endOfDay(today),
      sourceUrl: sourceUrls.santander,
      appliesToAllBranches: false,
    },
  });
  await prisma.promotionBranch.create({
    data: { promotionId: tataPocitosSantanderHoy.id, branchId: tataPocitos.id },
  });

  const tataPocitosOcaManana = await prisma.promotion.create({
    data: {
      bankId: oca.id,
      merchantChainId: tata.id,
      discountPercentage: 40,
      paymentType: PaymentType.CREDITO,
      cardName: 'OCA',
      capAmount: 2000,
      validFrom: startOfDay(addDays(today, 1)),
      validUntil: endOfDay(addDays(today, 1)),
      sourceUrl: sourceUrls.oca,
      appliesToAllBranches: false,
    },
  });
  await prisma.promotionBranch.create({
    data: { promotionId: tataPocitosOcaManana.id, branchId: tataPocitos.id },
  });

  // Promo de cadena completa en Ta-Ta (aplica a todas las sucursales), vigente
  // toda la semana -> demuestra la distinción cadena vs. sucursal específica.
  await prisma.promotion.create({
    data: {
      bankId: itau.id,
      merchantChainId: tata.id,
      discountPercentage: 10,
      paymentType: PaymentType.CREDITO,
      cardName: 'Itaú Mastercard',
      capAmount: 1000,
      validFrom: startOfDay(today),
      validUntil: endOfDay(addDays(today, 7)),
      sourceUrl: sourceUrls.itau,
      appliesToAllBranches: true,
    },
  });

  // Ta-Ta Hiper Cerro: promo propia con débito, vigente toda la semana.
  await prisma.promotion
    .create({
      data: {
        bankId: santander.id,
        merchantChainId: tata.id,
        discountPercentage: 15,
        paymentType: PaymentType.DEBITO,
        cardName: 'Santander Débito',
        validFrom: startOfDay(today),
        validUntil: endOfDay(addDays(today, 7)),
        sourceUrl: sourceUrls.santander,
        appliesToAllBranches: false,
      },
    })
    .then((promo) =>
      prisma.promotionBranch.create({
        data: { promotionId: promo.id, branchId: tataCerro.id },
      }),
    );

  // Devoto: promo de cadena completa.
  await prisma.promotion.create({
    data: {
      bankId: oca.id,
      merchantChainId: devoto.id,
      discountPercentage: 12,
      paymentType: PaymentType.AMBOS,
      cardName: 'OCA',
      validFrom: startOfDay(today),
      validUntil: endOfDay(addDays(today, 7)),
      sourceUrl: sourceUrls.oca,
      appliesToAllBranches: true,
    },
  });

  // Farmashop: promo de cadena completa hoy, y una mejor en 3 días.
  await prisma.promotion.create({
    data: {
      bankId: itau.id,
      merchantChainId: farmashop.id,
      discountPercentage: 15,
      paymentType: PaymentType.CREDITO,
      cardName: 'Itaú Visa',
      capAmount: 800,
      validFrom: startOfDay(today),
      validUntil: endOfDay(addDays(today, 2)),
      sourceUrl: sourceUrls.itau,
      appliesToAllBranches: true,
    },
  });
  await prisma.promotion.create({
    data: {
      bankId: santander.id,
      merchantChainId: farmashop.id,
      discountPercentage: 25,
      paymentType: PaymentType.CREDITO,
      cardName: 'Santander Free',
      capAmount: 900,
      validFrom: startOfDay(addDays(today, 3)),
      validUntil: endOfDay(addDays(today, 7)),
      sourceUrl: sourceUrls.santander,
      appliesToAllBranches: true,
    },
  });

  // McDonald's: promo de fin de semana con OCA.
  const nextFriday = addDays(today, (5 - today.getDay() + 7) % 7 || 7);
  await prisma.promotion.create({
    data: {
      bankId: oca.id,
      merchantChainId: mcdonalds.id,
      discountPercentage: 30,
      paymentType: PaymentType.CREDITO,
      cardName: 'OCA',
      capAmount: 500,
      validFrom: startOfDay(nextFriday),
      validUntil: endOfDay(addDays(nextFriday, 2)),
      sourceUrl: sourceUrls.oca,
      appliesToAllBranches: true,
    },
  });

  console.log('Seed OK:', {
    bancos: 3,
    categorias: 3,
    cadenas: 4,
    sucursales: [
      tataPocitos,
      tataPuntaCarretas,
      tataTresCruces,
      tataCerro,
      devotoPuntaCarretas,
      farmashopPocitos,
      farmashopCentro,
      mcdonaldsPuntaCarretas,
    ].length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

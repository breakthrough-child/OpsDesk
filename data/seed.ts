// Synthetic data for the fictional "Brightside Bakery & Cafe Supplies". No real people.
// Everything is relative to BUSINESS_NOW so return-window logic is deterministic in tests and evals.

export const BUSINESS_NOW = '2026-11-10T12:00:00Z';
const DAY = 86400000;
const ago = (days: number) => new Date(new Date(BUSINESS_NOW).getTime() - days * DAY).toISOString();

export interface SeedProduct {
  sku: string;
  name: string;
  price: number;
  category: 'equipment' | 'consumable' | 'accessory';
  freight: boolean;
}

export const products: SeedProduct[] = [
  { sku: 'ES-200', name: 'ES-200 Dual Boiler Espresso Machine', price: 1299, category: 'equipment', freight: true },
  { sku: 'GR-90', name: 'GR-90 Flat Burr Grinder', price: 349, category: 'equipment', freight: false },
  { sku: 'DB-12', name: 'DB-12 Drip Brewer', price: 489, category: 'equipment', freight: false },
  { sku: 'IM-40', name: 'IM-40 Undercounter Ice Maker', price: 1149, category: 'equipment', freight: true },
  { sku: 'TP-58', name: '58 mm Tamper', price: 24.95, category: 'accessory', freight: false },
  { sku: 'PT-20', name: 'Milk Pitcher 20 oz', price: 18, category: 'accessory', freight: false },
  { sku: 'BN-HB5', name: 'House Blend Beans 5 lb', price: 54, category: 'consumable', freight: false },
  { sku: 'BN-DC5', name: 'Decaf Blend Beans 5 lb', price: 58, category: 'consumable', freight: false },
  { sku: 'SY-VAN', name: 'Vanilla Syrup 750 ml', price: 12.5, category: 'consumable', freight: false },
  { sku: 'SY-CAR', name: 'Caramel Syrup 750 ml', price: 12.5, category: 'consumable', freight: false },
  { sku: 'PB-100', name: 'Pastry Boxes 100 ct', price: 39, category: 'consumable', freight: false },
  { sku: 'CP-12', name: '12 oz Paper Cups 1000 ct', price: 79, category: 'consumable', freight: false },
  { sku: 'DS-1L', name: 'Brightside Descaler 1 L', price: 19, category: 'consumable', freight: false },
  { sku: 'AP-01', name: 'Cafe Apron', price: 22, category: 'accessory', freight: false },
  { sku: 'SC-01', name: 'Digital Coffee Scale', price: 39, category: 'accessory', freight: false },
];

export const customers = [
  { id: 'c01', name: 'Maya Lindqvist', email: 'maya.lindqvist@example.com' },
  { id: 'c02', name: 'Tomas Okafor', email: 'tomas.okafor@example.com' },
  { id: 'c03', name: 'Priya Raman', email: 'priya.raman@example.com' },
  { id: 'c04', name: 'Daniel Whitcombe', email: 'daniel.whitcombe@example.com' },
  { id: 'c05', name: 'Sofia Marchetti', email: 'sofia.marchetti@example.com' },
  { id: 'c06', name: 'Kwame Boateng', email: 'kwame.boateng@example.com' },
  { id: 'c07', name: 'Elena Petrova', email: 'elena.petrova@example.com' },
  { id: 'c08', name: 'Marcus Delacroix', email: 'marcus.delacroix@example.com' },
  { id: 'c09', name: 'Hannah Goldberg', email: 'hannah.goldberg@example.com' },
  { id: 'c10', name: 'Ravi Choudhury', email: 'ravi.choudhury@example.com' },
  { id: 'c11', name: 'Isabelle Moreau', email: 'isabelle.moreau@example.com' },
  { id: 'c12', name: 'Jonas Eriksen', email: 'jonas.eriksen@example.com' },
  { id: 'c13', name: 'Amara Nwosu', email: 'amara.nwosu@example.com' },
  { id: 'c14', name: 'Luca Ferraro', email: 'luca.ferraro@example.com' },
  { id: 'c15', name: 'Grace Tanaka', email: 'grace.tanaka@example.com' },
  { id: 'c16', name: 'Oliver Banks', email: 'oliver.banks@example.com' },
  { id: 'c17', name: 'Zainab Hussain', email: 'zainab.hussain@example.com' },
  { id: 'c18', name: 'Peter Novak', email: 'peter.novak@example.com' },
  { id: 'c19', name: 'Camila Duarte', email: 'camila.duarte@example.com' },
  { id: 'c20', name: 'Henry Fitzgerald', email: 'henry.fitzgerald@example.com' },
];

type Status = 'processing' | 'shipped' | 'delivered' | 'cancelled';
// [id, customer, status, placedDaysAgo, shippedDaysAgo|null, deliveredDaysAgo|null, [[sku, qty]...]]
type Row = [string, string, Status, number, number | null, number | null, Array<[string, number]>];

const rows: Row[] = [
  ['BB-1001', 'c01', 'delivered', 20, 19, 16, [['GR-90', 1]]],
  ['BB-1002', 'c02', 'delivered', 50, 49, 44, [['DB-12', 1]]],
  ['BB-1003', 'c03', 'shipped', 3, 2, null, [['BN-HB5', 2], ['SY-VAN', 2]]],
  ['BB-1004', 'c04', 'processing', 0.5, null, null, [['ES-200', 1]]],
  ['BB-1005', 'c05', 'delivered', 12, 11, 8, [['BN-DC5', 1]]],
  ['BB-1006', 'c06', 'delivered', 35, 34, 29, [['TP-58', 1], ['PT-20', 1]]],
  ['BB-1007', 'c07', 'cancelled', 10, null, null, [['PB-100', 2]]],
  ['BB-1008', 'c08', 'delivered', 9, 8, 5, [['IM-40', 1]]],
  ['BB-1009', 'c09', 'shipped', 12, 11, null, [['CP-12', 2]]],
  ['BB-1010', 'c10', 'delivered', 25, 24, 20, [['PB-100', 3]]],
  ['BB-1011', 'c01', 'delivered', 10, 9, 8, [['SC-01', 1], ['AP-01', 1]]],
  ['BB-1012', 'c11', 'processing', 1, null, null, [['DS-1L', 2]]],
  ['BB-1013', 'c12', 'delivered', 40, 39, 35, [['ES-200', 1]]],
  ['BB-1014', 'c13', 'delivered', 15, 14, 11, [['BN-HB5', 1]]],
  ['BB-1015', 'c14', 'shipped', 4, 3, null, [['DB-12', 1]]],
  ['BB-1016', 'c15', 'delivered', 30, 29, 26, [['GR-90', 1], ['TP-58', 1]]],
  ['BB-1017', 'c16', 'delivered', 2, 1.5, 1, [['SY-CAR', 1]]],
  ['BB-1018', 'c17', 'processing', 2, null, null, [['CP-12', 10]]],
  ['BB-1019', 'c18', 'delivered', 60, 59, 55, [['BN-HB5', 1], ['AP-01', 1]]],
  ['BB-1020', 'c19', 'delivered', 7, 6, 3, [['PT-20', 1], ['SC-01', 1]]],
  ['BB-1021', 'c20', 'shipped', 2, 1, null, [['ES-200', 1]]],
  ['BB-1022', 'c02', 'delivered', 14, 13, 10, [['SY-VAN', 1], ['DS-1L', 1]]],
  ['BB-1023', 'c03', 'delivered', 28, 27, 24, [['SC-01', 1]]],
  ['BB-1024', 'c04', 'delivered', 70, 69, 65, [['GR-90', 1]]],
  ['BB-1025', 'c05', 'cancelled', 18, null, null, [['CP-12', 1]]],
  ['BB-1026', 'c06', 'delivered', 5, 4, 2, [['BN-DC5', 2]]],
  ['BB-1027', 'c07', 'delivered', 22, 21, 18, [['DB-12', 1]]],
  ['BB-1028', 'c08', 'processing', 0.2, null, null, [['BN-HB5', 4]]],
  ['BB-1029', 'c09', 'delivered', 11, 10, 7, [['AP-01', 3]]],
  ['BB-1030', 'c10', 'shipped', 1, 0.5, null, [['TP-58', 1]]],
];

const bySku = new Map(products.map((p) => [p.sku, p]));

export const orders = rows.map(([id, customerId, status, placed, shipped, delivered, items]) => {
  const lines = items.map(([sku, qty]) => {
    const p = bySku.get(sku)!;
    return { sku, name: p.name, qty, unit_price: p.price };
  });
  const subtotal = Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100;
  const freight = items.some(([sku]) => bySku.get(sku)!.freight);
  const shippingCost = freight || subtotal >= 75 ? 0 : 7.95;
  return {
    id,
    customer_id: customerId,
    status,
    placed_at: ago(placed),
    shipped_at: shipped === null ? null : ago(shipped),
    delivered_at: delivered === null ? null : ago(delivered),
    items: lines,
    total: Math.round((subtotal + shippingCost) * 100) / 100,
    shipping_method: freight ? 'freight' : 'standard',
    carrier: freight ? 'Northwind Freight' : 'ParcelPost',
    tracking_number: shipped === null ? null : `${freight ? 'NF' : 'PP'}${id.slice(3)}${customerId.slice(1)}7731`,
  };
});

export const BOOKING_SLOT_DAYS = 10;

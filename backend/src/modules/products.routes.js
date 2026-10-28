import { Router } from 'express';
import { db } from '../db/index.js';
import { notFound } from '../utils/http.js';
import { stockBand, unitPrice, STOCK_STATUS } from '../domain/rules.js';

export const router = Router();

const productDto = p => {
  const product = { factoryRate: Number(p.FactoryRate), hasSleeves: !!p.HasSleeves, halfSleeveFactor: Number(p.HalfSleeveFactor) };
  return {
    id: p.ProductId, code: p.ProductCode, qrCode: p.QrCode, name: p.ProductName, icon: p.Icon, category: p.Category,
    brand: p.Brand, subBrand: p.SubBrand, factoryRate: product.factoryRate, halfRate: unitPrice(product, 'HALF'),
    mrp: Number(p.Mrp), scheme: p.SchemeText ? { text: p.SchemeText, buyQty: p.SchemeBuyQty, freeQty: p.SchemeFreeQty } : null,
    altProductId: p.AltProductId, moq: p.Moq, nonReturnable: !!p.NonReturnable, tag: p.Tag, hasSleeves: !!p.HasSleeves,
    colorCount: p.ColorCount, stockQty: p.StockQty, stockBand: stockBand(p.StockQty), frequent: !!p.Frequent,
  };
};
const LIST_SQL = `
  SELECT p.*, x.ColorCount, x.StockQty,
         CASE WHEN EXISTS (SELECT 1 FROM dbo.OrderLines l JOIN dbo.Orders o ON o.OrderId = l.OrderId
                           WHERE l.ProductId = p.ProductId AND o.UserId = @me AND o.OrderedAt >= DATEADD(DAY, -90, SYSUTCDATETIME()))
              THEN 1 ELSE 0 END AS Frequent
  FROM dbo.Products p
  OUTER APPLY (SELECT COUNT(DISTINCT c.ColorId) AS ColorCount, ISNULL(SUM(s.QtyOnHand), 0) AS StockQty
               FROM dbo.ProductColors c LEFT JOIN dbo.StockLevels s ON s.ColorId = c.ColorId WHERE c.ProductId = p.ProductId) x
  WHERE p.IsActive = 1`;

/* GET /products?tab=All|Frequently|Offer|New Launch|Must Selling&search= */
router.get('/products', async (req, res) => {
  const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
  const rows = await db.query(
    `${LIST_SQL} AND (@search IS NULL OR p.ProductName LIKE @search OR p.Brand LIKE @search OR p.SubBrand LIKE @search OR p.QrCode LIKE @search
       OR EXISTS (SELECT 1 FROM dbo.ProductColors c WHERE c.ProductId = p.ProductId AND (c.ColorName LIKE @search OR c.ColorCode LIKE @search)))
     ORDER BY p.ProductId`, { me: req.user.id, search });
  let list = rows.map(productDto);
  const tab = req.query.tab;
  if (tab === 'Frequently') list = list.filter(p => p.frequent);
  else if (tab === 'Offer') list = list.filter(p => p.scheme || p.tag === 'Offer');
  else if (tab === 'New Launch' || tab === 'Must Selling') list = list.filter(p => p.tag === tab);
  res.json(list);
});

router.get('/products/by-qr/:code', async (req, res) => {
  const p = await db.one(`${LIST_SQL} AND p.QrCode = @code`, { me: req.user.id, code: req.params.code.trim() });
  if (!p) throw notFound('Product for this QR');
  res.json(productDto(p));
});

/* GET /products/matrix?ids=1,2 — colours × sizes with stock status per cell */
router.get('/products/matrix', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 30);
  if (!ids.length) return res.json({ sizes: [], products: [] });
  const [sizes, products, colors, stock] = await db.queryMulti(
    `SELECT SizeCode FROM dbo.Sizes ORDER BY SortOrder;
     ${LIST_SQL} AND p.ProductId IN (SELECT value FROM OPENJSON(@ids));
     SELECT * FROM dbo.ProductColors WHERE ProductId IN (SELECT value FROM OPENJSON(@ids)) ORDER BY ProductId, ColorId;
     SELECT s.ColorId, s.SizeCode, s.StockStatus, s.QtyOnHand FROM dbo.StockLevels s
       JOIN dbo.ProductColors c ON c.ColorId = s.ColorId WHERE c.ProductId IN (SELECT value FROM OPENJSON(@ids));`,
    { me: req.user.id, ids: JSON.stringify(ids) });
  res.json({
    sizes: sizes.map(s => s.SizeCode),
    stockStatuses: STOCK_STATUS,
    products: products.map(p => ({
      ...productDto(p),
      colors: colors.filter(c => c.ProductId === p.ProductId).map(c => ({
        id: c.ColorId, code: c.ColorCode, name: c.ColorName, hex: c.HexValue, isCore: !!c.IsCore,
        stock: Object.fromEntries(stock.filter(s => s.ColorId === c.ColorId).map(s => [s.SizeCode, s.StockStatus])),
      })),
    })),
  });
});

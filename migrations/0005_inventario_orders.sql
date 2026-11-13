-- Órdenes / ventas (equipo chico).
-- orden = pedido (aún no es venta); venta = pagada/concretada; cancelada = revierte stock si se reservó.
-- con_factura / contra_pedido como flags simples.

CREATE TABLE IF NOT EXISTS inventory_orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'orden' CHECK (status IN ('orden', 'venta', 'cancelada')),
  with_invoice INTEGER NOT NULL DEFAULT 0,
  contra_pedido INTEGER NOT NULL DEFAULT 0,
  stock_reserved INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_id_number TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  total_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_username TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by_user_id TEXT,
  confirmed_by_username TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  cancelled_by_username TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_orders_created
  ON inventory_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_orders_status
  ON inventory_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES inventory_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_order_items_order
  ON inventory_order_items (order_id);

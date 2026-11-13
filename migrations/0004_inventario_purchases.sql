-- Compras a proveedor: al confirmar suben stock; al cancelar lo revierten.
-- Flujo simple para equipo chico (3–4 personas).

CREATE TABLE IF NOT EXISTS inventory_purchases (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_username TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  cancelled_by_username TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_purchases_created
  ON inventory_purchases (created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES inventory_purchases(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_purchase_items_purchase
  ON inventory_purchase_items (purchase_id);

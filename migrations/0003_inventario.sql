-- ExhaTech Inventario (Mayoreo Kenneth): catálogo compartido + % globales de reparto.
-- Fotos viven en R2 (photo_key); metadatos acá en D1.

CREATE TABLE IF NOT EXISTS inventory_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  split_impuestos REAL NOT NULL DEFAULT 0,
  split_pagina_web REAL NOT NULL DEFAULT 0,
  split_venta REAL NOT NULL DEFAULT 0,
  split_ganancia REAL NOT NULL DEFAULT 0,
  split_costo REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_by_username TEXT
);

INSERT OR IGNORE INTO inventory_settings (
  id, split_impuestos, split_pagina_web, split_venta, split_ganancia, split_costo,
  updated_at, updated_by_user_id, updated_by_username
) VALUES (1, 0, 0, 0, 0, 0, datetime('now'), NULL, NULL);

CREATE TABLE IF NOT EXISTS inventory_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  photo_content_type TEXT,
  stock_qty REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  commissions_json TEXT NOT NULL DEFAULT '[]',
  split_override_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_username TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  updated_by_username TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_products_active_sort
  ON inventory_products (active, sort_order, name COLLATE NOCASE);

-- Globales nuevos: Impuestos, ExhaTech, Vendedor, Comisión bancaria.
-- (Ganancia/Costo salen de globales: viven en el producto.)
-- Reparto por periodo: flag repartida en ventas concretadas.

ALTER TABLE inventory_settings ADD COLUMN split_exhatech REAL NOT NULL DEFAULT 2.5;
ALTER TABLE inventory_settings ADD COLUMN split_vendedor REAL NOT NULL DEFAULT 10;
ALTER TABLE inventory_settings ADD COLUMN split_comision_bancaria REAL NOT NULL DEFAULT 0;

UPDATE inventory_settings
SET split_impuestos = 13,
    split_exhatech = CASE
      WHEN COALESCE(split_pagina_web, 0) > 0 THEN split_pagina_web
      ELSE 2.5
    END,
    split_vendedor = CASE
      WHEN COALESCE(split_venta, 0) > 0 THEN split_venta
      ELSE 10
    END
WHERE id = 1;

ALTER TABLE inventory_orders ADD COLUMN repartida INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_orders ADD COLUMN repartida_at TEXT;
ALTER TABLE inventory_orders ADD COLUMN repartida_by_user_id TEXT;
ALTER TABLE inventory_orders ADD COLUMN repartida_by_username TEXT;

-- Precio/margen/descuento por producto.
-- Globales siguen en inventory_settings (no se sobreescriben por producto).

ALTER TABLE inventory_products ADD COLUMN margin_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE inventory_products ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0;

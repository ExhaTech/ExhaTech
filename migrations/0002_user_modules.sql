-- ExhaTech: permisos de módulo por usuario (Contabilidad, Bitácora, Inventario).
-- Contabilidad/Bitácora default ON (compat); Inventario default OFF (opt-in).

ALTER TABLE users ADD COLUMN module_contabilidad INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN module_bitacora INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN module_inventario INTEGER NOT NULL DEFAULT 0;

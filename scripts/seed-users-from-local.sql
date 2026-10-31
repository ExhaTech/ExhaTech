-- Usuarios migrados desde data/users.local.json (mismos salt/hash).
-- Correr:
--   npx wrangler d1 execute exhatech-db --remote --file scripts/seed-users-from-local.sql

INSERT OR IGNORE INTO users (
  id, username, display_name, role, active,
  password_salt, password_hash, billing_day_start,
  created_at, updated_at
) VALUES
(
  'u_mvh4cz5d_467aa391',
  'admin',
  'Admin',
  'admin',
  1,
  'Bq1WVv98HMMXVEV1+j2t4w==',
  'XRTrmX1UyOy6cCxzcWQIiccpbED0AIZ7aL0Cc2kHFaxVL9ovrG0l/g5zS4Gt71Z2GfWo25sZGWsy6VfYEoUjJw==',
  1,
  '2026-10-20T20:11:51.409Z',
  '2026-10-31T20:40:00.000Z'
),
(
  'u_mvh4cz6e_69c2b42b',
  'yurguen_hernandez',
  'Yurguen',
  'user',
  1,
  '38rAgbiX2OM+nQklUUkUug==',
  'MbNGr53MSP23a/hR6sNw3+Ndkv7A4qSohc8VRRY1YfsNMjRDTZpUCIvKvZg2Q2iUkENwA6hdBmdEXW6pUteNQA==',
  27,
  '2026-10-20T20:11:51.446Z',
  '2026-10-31T20:40:00.000Z'
),
(
  'u_mvie677g_16a2656b',
  'marco_cascante',
  'Marco',
  'user',
  1,
  'QV7ZiPqdP7hKiAXEoAoqaA==',
  'He7wPkSvQhuLrjGrnNZ4TKbffDqwekOSXl1E9utpcrpUr3lhLvDfxknC5Fqmz0Zo+tt3FoWsIGLOiUTWDt9fBA==',
  1,
  '2026-10-21T17:34:17.596Z',
  '2026-10-31T20:40:00.000Z'
);

-- Daftar pilihan yang dapat dipakai ulang di banyak formulir (dropdown).
-- owner_id NULL = global (dikelola admin, dapat dipakai semua pembuat form).
CREATE TABLE option_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  items       jsonb NOT NULL DEFAULT '[]',     -- [{id, text}]
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX option_lists_owner ON option_lists(owner_id);

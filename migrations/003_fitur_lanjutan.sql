-- Fitur lanjutan: daftar peserta, absensi, bank soal, percobaan ulang, anti-curang,
-- unggah berkas peserta, nomor sertifikat, tautan pendek.
ALTER TABLE forms
  ADD COLUMN alias text,
  ADD COLUMN checkin_token text NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  ADD COLUMN cert_seq int NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX forms_alias_lower ON forms (lower(alias)) WHERE alias IS NOT NULL;
CREATE UNIQUE INDEX forms_checkin_token ON forms (checkin_token);

CREATE TABLE allowed_participants (
  form_id    uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  email      text NOT NULL DEFAULT '',
  identifier text NOT NULL DEFAULT '',
  name       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, email, identifier)
);
CREATE INDEX allowed_email ON allowed_participants (form_id, lower(email));
CREATE INDEX allowed_ident ON allowed_participants (form_id, lower(identifier));

ALTER TABLE responses
  ADD COLUMN attempt_no int NOT NULL DEFAULT 1,
  ADD COLUMN question_ids jsonb,
  ADD COLUMN violations jsonb NOT NULL DEFAULT '[]';

CREATE TABLE response_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  filename    text NOT NULL,
  mime        text NOT NULL,
  size        int  NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX response_files_resp ON response_files (response_id);

CREATE TABLE checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL DEFAULT '',
  email      text NOT NULL,
  identifier text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX checkins_unique ON checkins (form_id, lower(email));

ALTER TABLE certificates
  ADD COLUMN number text NOT NULL DEFAULT '',
  ADD COLUMN seq int;

CREATE TABLE question_banks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES users(id) ON DELETE CASCADE,   -- NULL = global
  name       text NOT NULL,
  questions  jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_banks_owner ON question_banks (owner_id);

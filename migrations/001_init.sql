-- UIKA Form: skema awal
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub         text UNIQUE,
  email       text NOT NULL,
  name        text NOT NULL DEFAULT '',
  identifier  text NOT NULL DEFAULT '',          -- NIM / NIP dari E-Portal
  role        text NOT NULL DEFAULT 'creator' CHECK (role IN ('admin','creator','user')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE forms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL DEFAULT 'Formulir tanpa judul',
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  theme       jsonb NOT NULL DEFAULT '{}',
  settings    jsonb NOT NULL DEFAULT '{}',
  cert        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_owner ON forms(owner_id);

-- Editor tambahan: email yang didaftarkan pembuat form
CREATE TABLE form_editors (
  form_id    uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  email      text NOT NULL,
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, email)
);
CREATE INDEX form_editors_email ON form_editors(email);

CREATE TABLE questions (
  id          uuid PRIMARY KEY,
  form_id     uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  position    int  NOT NULL,
  type        text NOT NULL,
  title       text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  required    boolean NOT NULL DEFAULT false,
  options     jsonb NOT NULL DEFAULT '[]',
  correct     jsonb NOT NULL DEFAULT '[]',
  points      numeric NOT NULL DEFAULT 0,
  config      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX questions_form ON questions(form_id, position);

CREATE TABLE responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL DEFAULT '',
  email         text NOT NULL DEFAULT '',
  identifier    text NOT NULL DEFAULT '',
  answers       jsonb NOT NULL DEFAULT '{}',
  essay_scores  jsonb NOT NULL DEFAULT '{}',
  score         numeric NOT NULL DEFAULT 0,
  max_score     numeric NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','auto_submitted')),
  graded        boolean NOT NULL DEFAULT true,
  started_at    timestamptz NOT NULL DEFAULT now(),
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  cert_code     text,
  ip_hash       text
);
CREATE INDEX responses_form ON responses(form_id, status);
CREATE INDEX responses_user ON responses(form_id, user_id);
CREATE INDEX responses_email ON responses(form_id, lower(email));

CREATE TABLE certificates (
  code        text PRIMARY KEY,
  response_id uuid NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  form_id     uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL DEFAULT '',
  issued_at   timestamptz NOT NULL DEFAULT now(),
  emailed_at  timestamptz
);

CREATE TABLE uploads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

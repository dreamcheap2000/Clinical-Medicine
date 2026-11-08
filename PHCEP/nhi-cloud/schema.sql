CREATE TABLE IF NOT EXISTS nhi_users (
  subject text PRIMARY KEY,
  email text NOT NULL,
  credentials text NOT NULL
);
CREATE TABLE IF NOT EXISTS nhi_clinics (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_subject text NOT NULL REFERENCES nhi_users(subject),
  sheet_id text UNIQUE,
  receiver_url text,
  signing_key text NOT NULL,
  ready boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS nhi_members (
  clinic_id uuid NOT NULL REFERENCES nhi_clinics(id),
  email text NOT NULL,
  subject text,
  role text NOT NULL CHECK (role IN ('admin', 'clinician')),
  PRIMARY KEY(clinic_id, email)
);
CREATE TABLE IF NOT EXISTS nhi_sessions (
  hash text PRIMARY KEY,
  subject text NOT NULL REFERENCES nhi_users(subject),
  expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS nhi_auth_states (
  hash text PRIMARY KEY,
  google_verifier text NOT NULL,
  nonce text NOT NULL,
  extension_id text NOT NULL,
  challenge text NOT NULL,
  expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS nhi_auth_codes (
  hash text PRIMARY KEY,
  subject text NOT NULL REFERENCES nhi_users(subject),
  challenge text NOT NULL,
  expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS nhi_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES nhi_clinics(id),
  subject text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

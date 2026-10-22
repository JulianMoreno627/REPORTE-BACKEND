CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'CITIZEN' CHECK (role IN ('CITIZEN', 'OFFICIAL')),
  agency        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id              UUID PRIMARY KEY,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  status          TEXT NOT NULL DEFAULT 'REPORTED',
  road_type       TEXT NOT NULL DEFAULT 'SECONDARY',
  report_ids      JSONB NOT NULL DEFAULT '[]',
  reporter_ids    JSONB NOT NULL DEFAULT '[]',
  category_counts JSONB NOT NULL DEFAULT '{}',
  history         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location GEOGRAPHY(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_location_gix ON incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS incidents_location_geom_gix ON incidents USING GIST ((location::geometry));

CREATE TABLE IF NOT EXISTS reports (
  id                UUID PRIMARY KEY,
  incident_id       UUID,
  citizen_id        UUID NOT NULL,
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  category          TEXT NOT NULL,
  road_type         TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  photo_url         TEXT,
  photo_check       TEXT NOT NULL DEFAULT 'NONE',
  photo_distance_m  INTEGER,
  client_request_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS location GEOGRAPHY(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS reports_incident_idx ON reports (incident_id);
CREATE INDEX IF NOT EXISTS reports_citizen_idx ON reports (citizen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_location_gix ON reports USING GIST (location);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL,
  incident_id UUID,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS photos (
  name       TEXT PRIMARY KEY,
  mime_type  TEXT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW incidents_map AS
SELECT
  i.id,
  i.status,
  i.road_type,
  jsonb_array_length(i.report_ids) AS report_count,
  i.created_at,
  i.updated_at,
  i.location::geometry AS geom
FROM incidents i;

CREATE OR REPLACE VIEW reports_map AS
SELECT
  r.id,
  r.created_at,
  u.name AS citizen,
  r.category,
  r.description,
  r.photo_check,
  r.incident_id,
  round(ST_Distance(r.location, i.location)::numeric, 1) AS meters_to_incident,
  r.location::geometry AS geom
FROM reports r
LEFT JOIN users u ON u.id = r.citizen_id
LEFT JOIN incidents i ON i.id = r.incident_id;

-- Maritime Event Oracle — Database Schema
-- Requires TimescaleDB + PostGIS extensions

CREATE EXTENSION IF NOT EXISTS timescaledb;
-- PostGIS is optional: all geo operations run in Node.js (Turf.js).
-- Uncomment if using a PostGIS-enabled image:
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────
-- Vessels
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vessels (
  mmsi        CHAR(9)      PRIMARY KEY,
  imo         VARCHAR(20),
  name        VARCHAR(100),
  ship_type   SMALLINT,
  first_seen  TIMESTAMPTZ  NOT NULL,
  last_seen   TIMESTAMPTZ  NOT NULL
);

-- ─────────────────────────────────────────
-- Positions (hypertable)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  time        TIMESTAMPTZ  NOT NULL,
  mmsi        CHAR(9)      NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  sog         REAL         NOT NULL,  -- knots
  cog         REAL         NOT NULL,
  heading     SMALLINT,
  nav_status  SMALLINT,
  source      VARCHAR(32)  NOT NULL DEFAULT 'aisstream',
  msg_type    SMALLINT
);

SELECT create_hypertable('positions', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS positions_mmsi_time ON positions (mmsi, time DESC);

-- ─────────────────────────────────────────
-- Vessel state snapshots (FSM persistence)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vessel_states (
  mmsi          CHAR(9)      PRIMARY KEY,
  state         VARCHAR(20)  NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  tracking_since TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- Anchor batches (Merkle anchoring)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anchor_batches (
  id            VARCHAR(40)  PRIMARY KEY,  -- batch_<timestamp>
  merkle_root   CHAR(64)     NOT NULL,      -- hex, no 0x
  hash_algo     VARCHAR(16)  NOT NULL DEFAULT 'sha256',
  tx_hash       CHAR(66),                   -- 0x + 64 hex
  block_number  BIGINT,
  events_from   TIMESTAMPTZ  NOT NULL,
  events_to     TIMESTAMPTZ  NOT NULL,
  event_count   INT          NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  confirmed_at  TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- Events
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                   VARCHAR(50)  PRIMARY KEY,  -- evt_<uuidv7>
  schema_version       VARCHAR(30)  NOT NULL DEFAULT 'maritime-event/v1',
  mmsi                 CHAR(9)      NOT NULL,
  imo                  VARCHAR(20),
  vessel_name          VARCHAR(100),
  event_type           VARCHAR(30)  NOT NULL,
  port                 CHAR(5)      NOT NULL DEFAULT 'NLRTM',
  timestamp            TIMESTAMPTZ  NOT NULL,
  confidence           REAL         NOT NULL,
  confidence_breakdown JSONB        NOT NULL,
  evidence             JSONB        NOT NULL,
  signature            VARCHAR(150) NOT NULL,
  anchor_batch_id      VARCHAR(40)  REFERENCES anchor_batches(id),
  merkle_proof         TEXT[],                     -- hex array
  gap_meta             JSONB,                      -- AIS_GAP specific fields
  corrects             VARCHAR(50)  REFERENCES events(id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_mmsi_time    ON events (mmsi, timestamp DESC);
CREATE INDEX IF NOT EXISTS events_type_time    ON events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS events_anchor_batch ON events (anchor_batch_id) WHERE anchor_batch_id IS NOT NULL;

-- ─────────────────────────────────────────
-- Voyages
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voyages (
  id                  VARCHAR(50)  PRIMARY KEY,  -- voy_<uuidv7>
  mmsi                CHAR(9)      NOT NULL,
  imo                 VARCHAR(20),
  vessel_name         VARCHAR(100),
  port                CHAR(5)      NOT NULL DEFAULT 'NLRTM',
  arrival_event_id    VARCHAR(50)  REFERENCES events(id),
  departure_event_id  VARCHAR(50)  REFERENCES events(id),
  period_from         TIMESTAMPTZ  NOT NULL,
  period_to           TIMESTAMPTZ,
  summary             JSONB,
  signature           VARCHAR(150),
  anchor_batch_id     VARCHAR(40)  REFERENCES anchor_batches(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voyages_mmsi ON voyages (mmsi, period_from DESC);

-- ─────────────────────────────────────────
-- API keys (auth)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           VARCHAR(50)  PRIMARY KEY,
  key_hash     CHAR(64)     NOT NULL UNIQUE,  -- SHA-256 of raw key
  name         VARCHAR(100) NOT NULL,
  scopes       TEXT[]       NOT NULL DEFAULT '{read}',
  rate_limit   INT          NOT NULL DEFAULT 100,  -- req/min
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- Vessels: add flag_state if missing
-- ─────────────────────────────────────────
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS flag_state CHAR(2);

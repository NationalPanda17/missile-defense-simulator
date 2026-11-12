-- Missile Defense Simulator: persistent campaign storage.

CREATE TABLE players (
  id            uuid PRIMARY KEY,
  callsign      text NOT NULL DEFAULT 'Commander' CHECK (char_length(callsign) BETWEEN 1 AND 40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per scenario run. Summary columns are denormalized from the latest save
-- so campaign history can be listed without reading large state documents.
CREATE TABLE campaigns (
  id                uuid PRIMARY KEY,
  player_id         uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name              text NOT NULL,
  mode              text NOT NULL CHECK (mode IN ('campaign', 'sandbox', 'crisis', 'training')),
  seed              bigint NOT NULL,
  status            text NOT NULL CHECK (status IN ('briefing', 'running', 'complete')),
  phase_index       integer NOT NULL,
  phase_name        text NOT NULL,
  phase_count       integer NOT NULL,
  sim_hour          integer NOT NULL,
  score             numeric(5, 1),
  grade             text,
  score_components  jsonb,
  objectives_met    integer NOT NULL DEFAULT 0,
  objectives_total  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX campaigns_player_updated_idx ON campaigns (player_id, updated_at DESC);

-- Save slots. A slot always points at the campaign run it captured.
CREATE TABLE saves (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot          text NOT NULL CHECK (slot IN ('auto', 'slot1', 'slot2', 'slot3')),
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  save_version  integer NOT NULL,
  sim_hour      integer NOT NULL,
  state         jsonb NOT NULL,
  size_bytes    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, slot)
);
CREATE INDEX saves_campaign_idx ON saves (campaign_id);

-- One row per completed phase: a durable record of how the campaign progressed.
CREATE TABLE campaign_phase_results (
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phase         integer NOT NULL,
  objective_id  text NOT NULL,
  text          text NOT NULL,
  met           boolean NOT NULL,
  value         numeric NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, objective_id)
);

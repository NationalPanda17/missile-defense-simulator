-- Training Academy progress per player, so a signed-in player's lessons and certification follow them.
CREATE TABLE academy_progress (
  player_id   uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  done        text[] NOT NULL DEFAULT '{}',
  best_exam   jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

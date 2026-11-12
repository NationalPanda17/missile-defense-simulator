-- Practice drill personal bests: { "<drill id>": { "best": 0-100, "stars": 0-3 } }.
ALTER TABLE academy_progress ADD COLUMN drills jsonb NOT NULL DEFAULT '{}'::jsonb;

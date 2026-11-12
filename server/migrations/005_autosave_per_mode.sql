-- Separate autosaves per kind of play, so a training drill never overwrites a campaign autosave.
ALTER TABLE saves DROP CONSTRAINT IF EXISTS saves_slot_check;
ALTER TABLE saves ADD CONSTRAINT saves_slot_check
  CHECK (slot IN ('auto', 'autoacademy', 'autocrisis', 'autosandbox', 'slot1', 'slot2', 'slot3'));

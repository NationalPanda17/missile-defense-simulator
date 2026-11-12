// Data access for players, campaigns and save slots. All SQL lives here.
import type pg from 'pg';
import { SAVE_VERSION, computeScore, type SimState } from '../src/engine';
import type { AcademyProgress, CampaignDetail, CampaignSummary, DrillRecord, ExamRecord, SaveSummary } from '../src/shared/api';

export class Repo {
  constructor(private pool: pg.Pool) {}

  async getAcademy(playerId: string): Promise<AcademyProgress> {
    const r = await this.pool.query<{ done: string[]; best_exam: ExamRecord | null; drills: Record<string, DrillRecord> }>(
      'SELECT done, best_exam, drills FROM academy_progress WHERE player_id = $1', [playerId]);
    return r.rows[0] ? { done: r.rows[0].done, bestExam: r.rows[0].best_exam, drills: r.rows[0].drills } : { done: [], bestExam: null, drills: {} };
  }

  /** Merges progress from a browser into the stored progress: lessons are never un-done, and the better exam wins. */
  async mergeAcademy(playerId: string, incoming: AcademyProgress): Promise<AcademyProgress> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<{ done: string[]; best_exam: ExamRecord | null; drills: Record<string, DrillRecord> }>(
        'SELECT done, best_exam, drills FROM academy_progress WHERE player_id = $1 FOR UPDATE', [playerId]);
      const cur = r.rows[0] ?? { done: [], best_exam: null, drills: {} };
      const drills = { ...cur.drills };
      for (const [id, d] of Object.entries(incoming.drills ?? {})) {
        const c = drills[id];
        drills[id] = c ? { best: Math.max(c.best, d.best), stars: Math.max(c.stars, d.stars) } : d;
      }
      const merged: AcademyProgress = {
        done: [...new Set([...cur.done, ...incoming.done])].sort(),
        bestExam: betterExam(cur.best_exam, incoming.bestExam),
        drills,
      };
      await client.query(
        `INSERT INTO academy_progress (player_id, done, best_exam, drills, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (player_id) DO UPDATE SET done = EXCLUDED.done, best_exam = EXCLUDED.best_exam, drills = EXCLUDED.drills, updated_at = now()`,
        [playerId, merged.done, merged.bestExam ? JSON.stringify(merged.bestExam) : null, JSON.stringify(drills)],
      );
      await client.query('COMMIT');
      return merged;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async setCallsign(playerId: string, callsign: string) {
    await this.pool.query('UPDATE players SET callsign = $2, last_seen_at = now() WHERE id = $1', [playerId, callsign]);
  }

  /** Writes a save slot and refreshes the owning campaign's summary in one transaction. */
  async putSave(playerId: string, slot: string, state: SimState, rawJson: string): Promise<SaveSummary> {
    const campaignId = state.campaignId!;
    const score = computeScore(state); // recomputed server-side from the submitted state
    const phase = state.phases[state.phaseIndex];
    const complete = state.status === 'complete';
    const metCount = state.objectiveResults.filter((o) => o.met).length;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE players SET last_seen_at = now() WHERE id = $1', [playerId]);
      const owner = await client.query<{ player_id: string }>('SELECT player_id FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
      if (owner.rows[0] && owner.rows[0].player_id !== playerId) throw new HttpError(403, 'Campaign belongs to another player');
      await client.query(
        `INSERT INTO campaigns (id, player_id, name, mode, seed, status, phase_index, phase_name, phase_count, sim_hour,
                                score, grade, score_components, objectives_met, objectives_total, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $16::boolean THEN now() END)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, phase_index = EXCLUDED.phase_index,
           phase_name = EXCLUDED.phase_name, phase_count = EXCLUDED.phase_count, sim_hour = EXCLUDED.sim_hour,
           score = EXCLUDED.score, grade = EXCLUDED.grade, score_components = EXCLUDED.score_components,
           objectives_met = EXCLUDED.objectives_met, objectives_total = EXCLUDED.objectives_total,
           updated_at = now(),
           completed_at = COALESCE(campaigns.completed_at, EXCLUDED.completed_at)`,
        [campaignId, playerId, state.settings.name, state.settings.mode, Math.trunc(state.settings.seed), state.status,
          state.phaseIndex, phase.name, state.phases.length, state.hour, score.total.toFixed(1), score.grade,
          JSON.stringify(score.components), metCount, state.objectiveResults.length, complete],
      );
      for (const o of state.objectiveResults) {
        await client.query(
          `INSERT INTO campaign_phase_results (campaign_id, phase, objective_id, text, met, value)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (campaign_id, objective_id) DO NOTHING`,
          [campaignId, o.phase, o.objectiveId, o.text, o.met, Number.isFinite(o.value) ? o.value : 0],
        );
      }
      const r = await client.query<{ updated_at: Date; size_bytes: number }>(
        `INSERT INTO saves (player_id, slot, campaign_id, save_version, sim_hour, state, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (player_id, slot) DO UPDATE SET
           campaign_id = EXCLUDED.campaign_id, save_version = EXCLUDED.save_version, sim_hour = EXCLUDED.sim_hour,
           state = EXCLUDED.state, size_bytes = EXCLUDED.size_bytes, updated_at = now()
         RETURNING updated_at, size_bytes`,
        [playerId, slot, campaignId, SAVE_VERSION, state.hour, rawJson, Buffer.byteLength(rawJson)],
      );
      await client.query('COMMIT');
      return {
        slot, campaignId, name: state.settings.name, mode: state.settings.mode, hour: state.hour, phase: phase.name,
        status: state.status, sizeBytes: r.rows[0].size_bytes, savedAt: r.rows[0].updated_at.toISOString(),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async listSaves(playerId: string): Promise<SaveSummary[]> {
    const r = await this.pool.query(
      `SELECT s.slot, s.campaign_id, c.name, c.mode, s.sim_hour, c.phase_name, c.status, s.size_bytes, s.updated_at
         FROM saves s JOIN campaigns c ON c.id = s.campaign_id
        WHERE s.player_id = $1 ORDER BY s.slot`, [playerId]);
    return r.rows.map((x) => ({
      slot: x.slot, campaignId: x.campaign_id, name: x.name, mode: x.mode, hour: x.sim_hour, phase: x.phase_name,
      status: x.status, sizeBytes: x.size_bytes, savedAt: x.updated_at.toISOString(),
    }));
  }

  /** Returns the stored state as raw JSON text (avoids a parse/serialize round-trip). */
  async getSaveJson(playerId: string, slot: string): Promise<string | null> {
    const r = await this.pool.query<{ state: string }>(
      'SELECT state::text AS state FROM saves WHERE player_id = $1 AND slot = $2', [playerId, slot]);
    return r.rows[0]?.state ?? null;
  }

  async deleteSave(playerId: string, slot: string): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM saves WHERE player_id = $1 AND slot = $2', [playerId, slot]);
    return (r.rowCount ?? 0) > 0;
  }

  async listCampaigns(playerId: string, limit = 50): Promise<CampaignSummary[]> {
    const r = await this.pool.query(
      `SELECT * FROM campaigns WHERE player_id = $1 ORDER BY updated_at DESC LIMIT $2`, [playerId, limit]);
    return r.rows.map(toCampaign);
  }

  async getCampaign(playerId: string, id: string): Promise<CampaignDetail | null> {
    const c = await this.pool.query('SELECT * FROM campaigns WHERE player_id = $1 AND id = $2', [playerId, id]);
    if (!c.rows[0]) return null;
    const results = await this.pool.query(
      `SELECT phase, objective_id, text, met, value::float AS value FROM campaign_phase_results
        WHERE campaign_id = $1 ORDER BY phase, objective_id`, [id]);
    const slots = await this.pool.query('SELECT slot FROM saves WHERE campaign_id = $1 ORDER BY slot', [id]);
    return {
      ...toCampaign(c.rows[0]),
      phaseResults: results.rows.map((x) => ({ phase: x.phase, objectiveId: x.objective_id, text: x.text, met: x.met, value: x.value })),
      slots: slots.rows.map((x) => x.slot as string),
    };
  }

  async deleteCampaign(playerId: string, id: string): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM campaigns WHERE player_id = $1 AND id = $2', [playerId, id]);
    return (r.rowCount ?? 0) > 0;
  }
}

function toCampaign(x: Record<string, any>): CampaignSummary {
  return {
    id: x.id, name: x.name, mode: x.mode, seed: Number(x.seed), status: x.status, phaseIndex: x.phase_index,
    phaseName: x.phase_name, phaseCount: x.phase_count, hour: x.sim_hour,
    score: x.score === null ? null : Number(x.score), grade: x.grade, scoreComponents: x.score_components,
    objectivesMet: x.objectives_met, objectivesTotal: x.objectives_total,
    createdAt: x.created_at.toISOString(), updatedAt: x.updated_at.toISOString(),
    completedAt: x.completed_at ? x.completed_at.toISOString() : null,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

/** The better of two exam results: a pass beats a fail, then the higher score. */
export function betterExam(a: ExamRecord | null, b: ExamRecord | null): ExamRecord | null {
  if (!a) return b;
  if (!b) return a;
  if (a.passed !== b.passed) return a.passed ? a : b;
  return b.score > a.score ? b : a;
}

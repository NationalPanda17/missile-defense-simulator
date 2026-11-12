// Types shared by the persistence API (server/) and its browser client (src/store/remote.ts).

export interface SaveSummary {
  slot: string;
  campaignId: string;
  name: string;
  mode: string;
  hour: number;
  phase: string;
  status: string;
  sizeBytes: number;
  savedAt: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  mode: string;
  seed: number;
  status: string;
  phaseIndex: number;
  phaseName: string;
  phaseCount: number;
  hour: number;
  score: number | null;
  grade: string | null;
  scoreComponents: Record<string, number> | null;
  objectivesMet: number;
  objectivesTotal: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CampaignDetail extends CampaignSummary {
  phaseResults: { phase: number; objectiveId: string; text: string; met: boolean; value: number }[];
  slots: string[];
}

export interface AccountInfo {
  id: string;
  username: string;
  callsign: string;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
}

export interface AuthResult { user: AccountInfo; claimed?: boolean }

/** A certification exercise result. */
export interface ExamRecord { passed: boolean; met: number; total: number; score: number; grade: string; at: number }

/** Training Academy progress: lessons done and the best certification attempt. */
export interface AcademyProgress { done: string[]; bestExam: ExamRecord | null }

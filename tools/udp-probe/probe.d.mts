// probe.mjs'in masaüstü uygulaması için tür bildirimi (yalnızca kullanılan kısım)

export interface LineStepStat {
  step: number;
  label: string;
  rateBps: number;
  size: number;
  pps: number;
  planned: number;
  recv: number;
  lost: number;
  lossPct: number;
  reordPct: number;
  jitMs: number;
}

export interface LineFinding {
  code: string;
  tone: 'bad' | 'warn' | 'ok' | 'info';
  text: string;
  evidence: string;
}

export interface LinePhaseResult {
  runId: string;
  suite: string;
  stats: { up: LineStepStat[] | null; down: LineStepStat[] | null };
  findings: LineFinding[];
  streaming: boolean;
  unreachable: boolean;
  note?: string;
}

export interface LineSuitePhase {
  profile: string;
  mode: string;
  transport?: 'udp' | 'tcp';
  label?: string;
}

export type LineEvent =
  | { type: 'phase-start'; index: number; total: number; label: string }
  | { type: 'plan'; index: number; session: { streamLive: boolean } }
  | { type: 'second'; index: number; sec: number; total: number; step: number }
  | { type: 'phase-done'; index: number; total: number; result: LinePhaseResult }
  | { type: 'phase-error'; index: number; total: number; error: string; status?: number };

export interface RunSuiteOptions {
  server?: string;
  auth: { token: string } | { code: string; name: string };
  phases: LineSuitePhase[];
  suite?: string;
  client?: Record<string, unknown>;
  onEvent?: (event: LineEvent) => void;
  signal?: AbortSignal;
}

export const SUITES: Record<'tam' | 'hizli', LineSuitePhase[]>;
export const DEFAULT_SERVER: string;
export function runSuite(options: RunSuiteOptions): Promise<{
  suite: string;
  phases: { phase: LineSuitePhase; result?: LinePhaseResult; error?: string }[];
}>;

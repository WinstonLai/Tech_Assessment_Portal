import type { JSONContent } from '@tiptap/react';

export type AnswerType = 'rich_text' | 'code' | 'diagram_plus_text';
export type CandidateStatus = 'not_started' | 'in_progress' | 'submitted';
export type CodeLanguage = 'sql' | 'pyspark';

export interface Question {
  id: string;
  section: string;
  section_title: string;
  sort_order: number;
  title: string;
  prompt_md: string;
  answer_type: AnswerType;
  max_score: number;
}

export interface Candidate {
  id: string;
  email: string;
  full_name: string | null;
  access_expires_at: string;
  is_active: boolean;
  status: CandidateStatus;
  started_at: string | null;
  submitted_at: string | null;
  active_seconds: number;
  last_heartbeat_at: string | null;
  password_issued_at: string | null;
  created_at: string;
}

/** Excalidraw scene as persisted (non-deleted elements + minimal app state + embedded files). */
export interface DiagramScene {
  elements: readonly Record<string, unknown>[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export interface Answer {
  candidate_id: string;
  question_id: string;
  rich_text_json: JSONContent | null;
  rich_text_html: string | null;
  rich_text_plain: string | null;
  code: string | null;
  code_language: CodeLanguage;
  diagram_scene: DiagramScene | null;
  diagram_png: string | null;
  updated_at: string;
}

export type AnswerPatch = Partial<Omit<Answer, 'candidate_id' | 'question_id' | 'updated_at'>>;

export interface RubricItem {
  id: string;
  label: string;
  points: number;
  patterns: string[];
  match: 'any' | 'all';
  source: 'any' | 'text' | 'code' | 'diagram';
}

export interface AnswerKey {
  question_id: string;
  model_answer_md: string;
  rubric: RubricItem[];
}

export interface RubricHit {
  id: string;
  label: string;
  points: number;
  matched: boolean;
}

export interface Mark {
  candidate_id: string;
  question_id: string;
  auto_score: number | null;
  rubric_hits: RubricHit[] | null;
  final_score: number | null;
  reviewer_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface AssessmentInfo {
  title: string;
  intro_md: string;
}

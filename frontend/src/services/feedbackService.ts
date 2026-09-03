import axios from "axios";

export const API_BASE = "http://localhost:5000";

/** The four post-meal responses an employee can give. */
export const FEEDBACK_RESPONSES = ["Finished", "Left some", "Left most", "Wanted more"] as const;
export type FeedbackResponse = (typeof FEEDBACK_RESPONSES)[number];

/**
 * Share of a served portion wasted for each response. Mirrors RESPONSE_MODEL in
 * backend/lib/feedbackModel.js — keep the two in step.
 */
export const LEFTOVER_RATE: Record<FeedbackResponse, number> = {
  Finished: 0,
  "Left some": 0.3,
  "Left most": 0.7,
  "Wanted more": 0,
};

export type FeedbackSubmission = {
  employeeId: string;
  bookingId: string;
  dish: string;
  category: string;
  weekday: string;
  response: FeedbackResponse;
  servedOn: string;
  portionSize?: string;
};

export type FeedbackImpact = { totalResponses: number; dishPortionMultiplier: number; menuFamily: string };

export type ResponseDistribution = Record<FeedbackResponse, number>;

export type WasteTrendPoint = {
  weekStart: string;
  responses: number;
  averageLeftoverRate: number;
  portionSatisfaction: number;
  estimatedWasteKg: number;
};

/**
 * Aggregate-only analytics. Mirrors GET /admin/analytics/feedback — note there
 * is no field anywhere in this type that identifies an individual respondent.
 */
export type FeedbackAnalytics = {
  generatedAt: string;
  privacy: { scope: string; minimumSampleSize: number; suppressedDishes: number; note: string };
  totals: { responses: number; dishesCovered: number };
  portionSatisfaction: { score: number; distribution: ResponseDistribution; wantedMoreRate: number };
  averageLeftoverRate: number;
  estimatedWasteKg: number;
  mostWastefulDishes: { dish: string; responses: number; averageLeftoverRate: number; estimatedWasteKg: number; recommendedPortionChange: number }[];
  bestPerformingDishes: { dish: string; responses: number; portionSatisfaction: number; averageLeftoverRate: number; wantedMoreRate: number }[];
  weeklyWasteTrend: WasteTrendPoint[];
  weeklyTrendDeltaPoints: number;
  byWeekday: { weekday: string; responses: number; averageLeftoverRate: number; portionSatisfaction: number; portionMultiplier: number }[];
  learningSignal: { globalPortionMultiplier: number; confidence: number };
};

export type PipelineStage = {
  id: string;
  order: number;
  name: string;
  description: string;
  input: string;
  output: string;
  store: string;
  owner: string;
  metric: { label: string; value: number; unit: string };
  status: "active" | "awaiting-data";
};

export type PipelineView = { generatedAt: string; loopClosed: boolean; lastSignalRefresh: string | null; stages: PipelineStage[] };

/** A bucket is redacted to just its count when it falls below the sample threshold. */
export type SignalBucket = { responses: number; suppressed?: true; portionMultiplier?: number; averageLeftoverRate?: number; portionSatisfaction?: number; signalConfidence?: number };

export type PortionSignals = {
  totalResponses: number;
  minimumSampleSize?: number;
  global: { portionMultiplier: number; averageLeftoverRate?: number; portionSatisfaction?: number; signalConfidence?: number };
  byDish: Record<string, SignalBucket>;
  byMenuFamily: Record<string, SignalBucket>;
};

export function submitFeedback(payload: FeedbackSubmission) {
  return axios.post<{ recorded: unknown; impact: FeedbackImpact }>(`${API_BASE}/feedback`, payload);
}

export function getMyFeedback(employeeId: string) {
  return axios.get<{ feedback: { bookingId: string; dish: string; response: FeedbackResponse; servedOn: string }[] }>(
    `${API_BASE}/feedback/me`,
    { params: { employeeId } }
  );
}

export function getFeedbackAnalytics() {
  return axios.get<FeedbackAnalytics>(`${API_BASE}/admin/analytics/feedback`);
}

export function getPipeline(bookings: number) {
  return axios.get<PipelineView>(`${API_BASE}/pipeline`, { params: { bookings } });
}

/** Per-dish portion guidance, already redacted for thin samples by the server. */
export function getPortionSignals() {
  return axios.get<PortionSignals>(`${API_BASE}/admin/analytics/signals`);
}

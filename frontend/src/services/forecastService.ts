import axios from "axios";
import { API_BASE } from "./feedbackService";

/**
 * `predictedOrders` is the raw model output; `recommendedServings` is that
 * figure after the learned portion multiplier is applied. The gap between them
 * is what the feedback loop has taught the kitchen.
 */
export type Forecast = {
  predictedOrders: number;
  basePredictedOrders: number;
  recommendedServings: number;
  portionMultiplier: number;
  feedbackResponses: number;
  feedbackApplied: boolean;
  adjustmentReason: string;
  confidence: number;
  foodSavedKg: number;
  workerMeals: number;
  menuFamily?: string;
  weekday?: string;
};

export function getForecast(params?: { day?: string; menu?: string }) {
  return axios.get<Forecast>(`${API_BASE}/forecast`, { params });
}

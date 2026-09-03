/**
 * Client for the operational planning API.
 *
 * Every field the admin dashboard renders is declared here, and every one of
 * them is produced by the backend. Nothing in this file computes a KPI: if a
 * number is not in one of these types, the dashboard cannot show it.
 */

import axios from "axios";

import { API_BASE } from "./feedbackService";

/**
 * Placeholder credential matching backend/lib/requireAdmin.js. It is a shared
 * secret for local development, not real authentication — swap this for the
 * signed-in user's token once SSO is wired up.
 */
const ADMIN_TOKEN = "zerowaste-local-admin-token";

const authHeaders = () => ({ "x-admin-token": ADMIN_TOKEN });

export type MealCategory = "Breakfast" | "Lunch" | "Snacks";

/** Plate sizes an employee can pick. Mirrors PLATE_SIZES in portionAdvice.js. */
export type Appetite = "Light" | "Regular" | "Heavy";

/**
 * "Unrated" is a real state, not a missing value: a dish the kitchen has not
 * closed out often enough has no measured waste history, and inventing a
 * rating from the plan alone would just restate the safety buffer.
 */
export type RiskLevel = "Low" | "Medium" | "High" | "Unrated";

export type MenuItem = {
  dish: string;
  category: MealCategory;
  menuFamily: string;
  portionKg: number;
  description: string;
  calories: number;
  protein: number;
  price: number;
  isVeg: boolean;
  image: string;
};

export type PlateSize = { name: Appetite; grams: number; multiplier: number; description: string };

/**
 * Smart Plate advice for one dish.
 *
 * `measured` is the field the UI must branch on. It separates a suggestion the
 * feedback loop actually learned from the standard serving used when too few
 * people have rated the dish, so the interface never labels a default as a
 * recommendation.
 */
export type PortionAdvice = {
  dish: string;
  recommendedPlate: Appetite;
  measured: boolean;
  basis: "dish" | "menu-family" | "cafeteria" | "none";
  responses: number;
  reason: string;
};

export type PortionAdviceReport = { plateSizes: PlateSize[]; minSample: number; advice: PortionAdvice[] };

/**
 * One employee's own impact. Computed server-side against the same conversion
 * factors as the ESG report, so the personal and cafeteria-wide views agree.
 *
 * The percentage fields are nullable on purpose: "has not rated a meal yet" is
 * a different statement from "finishes 0% of meals".
 */
export type PersonalImpact = {
  meals: number;
  /** Bookings inside the current planning week, which is what `daysPlanned` measures. */
  mealsThisWeek: number;
  daysPlanned: number;
  ratedMeals: number;
  finishedMeals: number;
  finishedSharePercent: number | null;
  leftoverSharePercent: number | null;
  plannedKg: number;
  leftKg: number;
  savedKg: number;
  co2eSavedKg: number;
  waterSavedLitres: number;
  costSavedInr: number;
  /** What the personal figure is a share of, so the panel can show its working. */
  basis: { cafeteriaSavedKg: number; totalRatings: number; sharePercent: number; explanation: string };
  factors: { co2eKgPerKg: number; waterLitresPerKg: number; costInrPerKg: number; mealKg: number; basis: string };
};

/** The headline answer to "how much should the cafeteria prepare today?". */
export type TodaySummary = {
  totalEmployees: number;
  rosterSource: string;
  site: string;
  preBookings: number;
  employeesBooked: number;
  bookingsByCategory: Record<string, number>;
  predictedDemand: number;
  recommendedCook: number;
  preparedFoodPortions: number;
  preparedFoodKg: number;
  expectedLeftoverPortions: number;
  expectedLeftoverKg: number;
  expectedWasteSharePercent: number;
  /** Counter leftovers: cooked but not taken. The component the service log records. */
  expectedCounterLeftoverPortions: number;
  expectedCounterLeftoverKg: number;
  expectedCounterSharePercent: number;
  /** Plate waste: served but not eaten. Never appears in the service log. */
  expectedPlateWasteKg: number;
  wasteRisk: RiskLevel;
  wasteRiskBasis: "measured-service-history" | "insufficient-history";
  /** Measured share of cooked food left at the counter. Null until enough history. */
  measuredWasteSharePercent: number | null;
  measuredWasteDays: number;
  minimumRiskDays: number;
  participationPercent: number;
};

export type DishPlan = {
  dish: string;
  category: MealCategory;
  menuFamily: string;
  preBooked: number;
  predictedDemand: number;
  recommendedCook: number;
  bufferPortions: number;
  preparedFoodPortions: number;
  preparedFoodKg: number;
  baselineFoodPortions: number;
  portionMultiplier: number;
  /** Which bucket the portion signal came from once thin samples were suppressed. */
  portionSignalLevel: "dish" | "family" | "global" | "none";
  portionSignalResponses: number;
  turnoutRatio: number;
  demandBasis: string;
  demandBasisLabel: string;
  expectedCounterLeftoverPortions: number;
  expectedCounterLeftoverKg: number;
  /** Risk is graded on this share alone — the part the kitchen controls on the day. */
  expectedCounterSharePercent: number;
  expectedPlateWastePortions: number;
  expectedPlateWasteKg: number;
  expectedLeftoverPortions: number;
  expectedLeftoverKg: number;
  expectedWasteSharePercent: number;
  /** Graded on this dish's own measured counter waste, not on the plan. */
  risk: RiskLevel;
  riskBasis: "measured-dish-history" | "insufficient-history";
  measuredWasteSharePercent: number | null;
  measuredWasteDays: number;
  minimumRiskDays: number;
  /** Present only once close-of-service actuals have been recorded for this dish. */
  actualServed: number | null;
  actualCooked: number | null;
};

/** How the plan was reached, so the numbers can be challenged rather than trusted blindly. */
export type PlanMethod = {
  bufferRate: number;
  bufferMeasured: boolean;
  bufferGradedDays: number;
  turnoutMeasured: boolean;
  turnoutRatio: number;
  turnoutObservations: number;
  feedbackResponses: number;
  /** Categories whose raw demand exceeded headcount and were scaled down. */
  cappedCategories: string[];
  predictorError: string | null;
  minimumSampleSize: number;
};

export type TodayPlan = {
  generatedAt: string;
  date: string;
  weekday: string;
  isServiceDay: boolean;
  today: TodaySummary;
  dishes: DishPlan[];
  method: PlanMethod;
};

export type ForecastAccuracy = {
  accuracyPercent: number | null;
  meanAbsoluteErrorPortions: number | null;
  gradedDays: number;
  gradedDishes: number;
  minimumDays: number;
  /** Non-null when accuracy cannot yet be measured — render this instead of a number. */
  reason: string | null;
};

export type PredictionVsActualDay = {
  servedOn: string;
  predictedDemand: number;
  actualServed: number;
  recommendedCook: number;
  actualCooked: number;
  dishes: number;
  variance: number;
  accuracyPercent: number | null;
};

export type WastePrevented = {
  portions: number;
  kg: number;
  daysCovered: number;
  basis: string;
};

export type WasteDay = {
  servedOn: string;
  cookedPortions: number;
  leftoverPortions: number;
  leftoverKg: number;
  wasteSharePercent: number;
};

export type WasteWeek = {
  weekStart: string;
  cookedPortions: number;
  leftoverPortions: number;
  leftoverKg: number;
  days: number;
  wasteSharePercent: number;
};

export type HistoricalWaste = {
  daily: WasteDay[];
  weekly: WasteWeek[];
  totalLeftoverKg: number;
  daysRecorded: number;
};

export type DishPerformance = {
  dish: string;
  servedPortions: number;
  cookedPortions: number;
  leftoverPortions: number;
  leftoverKg: number;
  days: number;
  wasteSharePercent: number;
};

export type AccuracyReport = {
  generatedAt: string;
  forecastAccuracy: ForecastAccuracy;
  predictionVsActual: PredictionVsActualDay[];
  wastePrevented: WastePrevented;
  historicalWaste: HistoricalWaste;
  dishPerformance: DishPerformance[];
  buffer: { rate: number; measured: boolean; gradedDays: number };
};

export type Roster = { totalEmployees: number; site: string; source: string; updatedAt?: string };

export type BookingInput = {
  id: string;
  dish: string;
  category: string;
  servedOn: string;
  appetite?: string;
};

export type SaveBookingsResult = {
  accepted: number;
  /** Lines the server refused, with the reason. Never silently dropped. */
  rejected: { dish: string | null; servedOn: string | null; reason: string }[];
  dates: string[];
};

/**
 * Mirrors an employee's weekly plan to the server so the cafeteria can see
 * aggregate demand. `scopeDates` declares the full period the plan covers, so
 * clearing a day's meals actually removes them rather than leaving the previous
 * booking standing.
 */
export function saveBookings(employeeId: string, bookings: BookingInput[], scopeDates: string[] = []) {
  return axios.post<SaveBookingsResult>(`${API_BASE}/operations/bookings`, { employeeId, bookings, scopeDates });
}

export function getTodayPlan(date?: string) {
  return axios.get<TodayPlan>(`${API_BASE}/admin/operations/today`, {
    headers: authHeaders(),
    params: date ? { date } : {},
  });
}

export function getAccuracyReport(limit = 14) {
  return axios.get<AccuracyReport>(`${API_BASE}/admin/operations/accuracy`, {
    headers: authHeaders(),
    params: { limit },
  });
}

export type EsgImpact = {
  foodKg: number;
  mealsPreserved: number;
  co2ePreventedKg: number;
  waterSavedLitres: number;
  costSavedInr: number;
  daysCovered: number;
  basis: string;
};

export type EsgReport = {
  generatedAt: string;
  factors: { co2eKgPerKg: number; waterLitresPerKg: number; costInrPerKg: number; mealKg: number; basis: string };
  /** Food not cooked because feedback lowered portions — the claimable saving. */
  attributable: EsgImpact;
  /** Food still being thrown away. The remaining problem, not an achievement. */
  stillWasted: EsgImpact;
  weeklyTrend: { weekStart: string; leftoverKg: number; wasteSharePercent: number; co2eKg: number; days: number }[];
};

export function getEsgReport() {
  return axios.get<EsgReport>(`${API_BASE}/admin/operations/esg`, { headers: authHeaders() });
}

export function getRoster() {
  return axios.get<Roster>(`${API_BASE}/admin/operations/roster`, { headers: authHeaders() });
}

export function saveRoster(payload: { totalEmployees: number; site?: string }) {
  return axios.put<Roster>(`${API_BASE}/admin/operations/roster`, payload, { headers: authHeaders() });
}

export type ServiceRecordInput = { dish: string; cookedPortions: number; servedPortions: number };

/**
 * Close-of-service actuals. The server records a whole service day at once
 * (`{ servedOn, dishes: [...] }`); a flat single-dish body is rejected with
 * "dishes must be an array". This is the only write path into the actuals that
 * forecast accuracy, turnout and every waste figure are measured from.
 */
export function recordService(payload: { servedOn: string; dishes: ServiceRecordInput[] }) {
  return axios.post<{ recorded: number; rejected: { dish: string | null; reason: string }[] }>(
    `${API_BASE}/admin/operations/service`,
    payload,
    { headers: authHeaders() }
  );
}

export function getMenu() {
  return axios.get<{ menu: MenuItem[] }>(`${API_BASE}/operations/menu`);
}

/** A booking as the server stores it. Identity is already stripped on return. */
export type StoredBooking = {
  id: string;
  dish: string;
  category: MealCategory;
  appetite: Appetite;
  servedOn: string;
  weekday: string;
  bookedAt: string;
};

/** Reads back only this employee's own bookings. */
export function getMyBookings(employeeId: string) {
  return axios.get<{ bookings: StoredBooking[] }>(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
}

/** Smart Plate advice. Public and aggregate-only — no admin token required. */
export function getPortionAdvice() {
  return axios.get<PortionAdviceReport>(`${API_BASE}/operations/portion-advice`);
}

/** This employee's own impact. Self-service: returns nothing about anyone else. */
export function getMyImpact(employeeId: string) {
  return axios.get<PersonalImpact>(`${API_BASE}/operations/impact/me`, { params: { employeeId } });
}

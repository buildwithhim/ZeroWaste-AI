import axios from "axios";

export type Forecast = { predictedOrders: number; confidence: number; foodSavedKg: number; workerMeals: number };

export function getForecast() {
  return axios.get<Forecast>("http://localhost:5000/forecast");
}

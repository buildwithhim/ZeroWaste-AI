import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import FluentLayout from "../layout/FluentLayout";
import { getForecast, type Forecast } from "../services/forecastService";

export type AdminOutletContext = { forecast: Forecast; isLoading: boolean };
const defaultForecast: Forecast = { predictedOrders: 337, confidence: 94, foodSavedKg: 18, workerMeals: 36 };

export default function AdminDashboard() {
  const [forecast, setForecast] = useState<Forecast>(defaultForecast);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getForecast().then(({ data }) => setForecast(data)).catch(() => setForecast(defaultForecast)).finally(() => setIsLoading(false));
  }, []);

  return <FluentLayout role="admin"><Outlet context={{ forecast, isLoading } satisfies AdminOutletContext} /></FluentLayout>;
}

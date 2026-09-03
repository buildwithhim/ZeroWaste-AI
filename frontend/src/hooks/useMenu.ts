/**
 * The menu, as the employee interface sees it.
 *
 * The dish list used to be a constant inside TodaysMenuPage, duplicating the
 * server catalogue. That made a whole class of state impossible to represent:
 * a hardcoded array is never loading, never empty and never fails, so the
 * employee screens had nothing to show when the cafeteria service was down --
 * they simply displayed a menu that might not be what is being cooked.
 *
 * Fetching it makes those states real, which is why loading/error are returned
 * here rather than left for each caller to invent.
 */

import { useCallback, useEffect, useState } from "react";

import { getMenu, getPortionAdvice, type Appetite, type PortionAdvice } from "../services/operationsService";
import { toMenuItem, type MenuItem } from "../types/menu";

export type MenuLoadState = "loading" | "ready" | "error";
/**
 * Advice has its own state because it fails independently of the menu. Folding
 * a failed request into an empty advice map made the home page tell employees
 * "not enough ratings yet" when the truth was that the suggestion service was
 * unreachable -- blaming missing data for a network fault, and inviting an
 * action that could not fix it.
 */
export type AdviceLoadState = "loading" | "ready" | "unavailable";

export function useMenu() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [advice, setAdvice] = useState<Map<string, PortionAdvice>>(new Map());
  const [state, setState] = useState<MenuLoadState>("loading");
  const [adviceState, setAdviceState] = useState<AdviceLoadState>("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      /**
       * Advice is requested alongside the menu but must not be able to fail the
       * menu: a serving suggestion is a nicety, the list of what is being
       * cooked is the point of the screen.
       */
      const [menuResponse, adviceResponse] = await Promise.all([getMenu(), getPortionAdvice().catch(() => null)]);
      setItems(menuResponse.data.menu.map(toMenuItem));
      setAdvice(new Map((adviceResponse?.data.advice ?? []).map((entry) => [entry.dish, entry])));
      setAdviceState(adviceResponse ? "ready" : "unavailable");
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The plate to pre-select for a dish. Falls back to the employee's own saved
   * preference when the cafeteria has too little feedback to advise, so a
   * one-tap booking always has a sensible portion attached.
   */
  const recommendedPlate = useCallback(
    (dish: string, fallback: Appetite): Appetite => {
      const entry = advice.get(dish);
      return entry?.measured ? entry.recommendedPlate : fallback;
    },
    [advice]
  );

  return { items, advice, state, adviceState, reload: load, recommendedPlate };
}

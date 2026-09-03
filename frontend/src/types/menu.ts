/**
 * The shape of a dish as the employee interface renders it.
 *
 * This used to be declared inside MenuCard, so every screen that needed the
 * type dragged a whole component in with it. Those components have since been
 * removed -- they were built around a one-dish-at-a-time ordering flow the app
 * no longer has, and each carried a fixed "AI Recommended Portion: Regular"
 * badge that was never a recommendation, just a label.
 *
 * The type outlives them because it is the contract between the menu API and
 * the cards. Fields mirror the server catalogue in
 * backend/lib/operations/menu.js. `id` is a render key only; dishes are
 * identified by `name` everywhere else.
 */
export type MenuItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  calories: number;
  protein: number;
  price: number;
  image: string;
  isVeg: boolean;
};

/**
 * Adapts a server catalogue row to the shape the cards render. `id` is derived
 * from position because the server keys dishes by name, not by number, and
 * React only needs the key to be stable within a render.
 *
 * It lives here rather than in useMenu because the booking context also has to
 * rebuild dishes -- when it reads a saved plan back from the server it gets
 * dish names, and has to find the catalogue row each one refers to.
 */
export function toMenuItem(
  entry: {
    dish: string;
    category: string;
    description: string;
    calories: number;
    protein: number;
    price: number;
    isVeg: boolean;
    image: string;
  },
  index: number
): MenuItem {
  return {
    id: index + 1,
    name: entry.dish,
    category: entry.category,
    description: entry.description,
    calories: entry.calories,
    protein: entry.protein,
    price: entry.price,
    isVeg: entry.isVeg,
    image: entry.image,
  };
}

/**
 * Canonical dish catalogue.
 *
 * The forecasting model reasons about menu families (see menuTaxonomy) while
 * employees book individual dishes, so the operational planner needs both. This
 * module is the server-side source of truth for which dishes exist; before it,
 * the only dish list lived in the React bundle, which meant the backend could
 * not produce a dish-level plan without being told what the menu was.
 *
 * `portionKg` is the cooked weight of one serving. It is what converts portion
 * counts into the kilograms shown on the waste panels, so it is kept here next
 * to the dish rather than as a single canteen-wide average.
 *
 * The descriptive fields (description, calories, protein, price, image) exist
 * because the employee menu used to carry its own copy of this list inside the
 * React bundle. Two lists meant a dish could be renamed here and still appear
 * under its old name to employees, and it meant the app could not show a menu
 * without shipping a new frontend build. They live here so there is exactly one
 * answer to "what is on the menu".
 */

const { menuFamilyFor } = require("../menuTaxonomy");

/** Cooked weight per serving, in kg, by meal category. */
const CATEGORY_PORTION_KG = { Breakfast: 0.28, Lunch: 0.42, Snacks: 0.16 };

const photo = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`;

const CATALOGUE = [
  { dish: "Idli Sambar", category: "Breakfast", description: "Steamed rice cakes with lentil sambar and coconut chutney.", calories: 290, protein: 9, price: 55, isVeg: true, image: photo("photo-1630383249896-424e482df921") },
  { dish: "Masala Dosa", category: "Breakfast", description: "Crisp dosa with spiced potato, sambar and chutney.", calories: 410, protein: 10, price: 75, isVeg: true, image: photo("photo-1668236543090-82eba5ee5976") },
  { dish: "Poha", category: "Breakfast", description: "Yellow poha with peanuts, curry leaves and lemon.", calories: 270, protein: 7, price: 45, isVeg: true, image: photo("photo-1601050690117-94f5f6fa8bd7") },
  { dish: "Upma", category: "Breakfast", description: "Vegetable upma with tempered spices and coriander.", calories: 260, protein: 6, price: 45, isVeg: true, image: photo("photo-1547592180-85f173990554") },
  { dish: "Veg Biryani", category: "Lunch", description: "Fragrant basmati rice with vegetables and raita.", calories: 520, protein: 13, price: 125, isVeg: true, image: photo("photo-1563379091339-03b21ab4a4f8") },
  { dish: "Rajma Chawal", category: "Lunch", description: "Slow-cooked rajma with steamed rice and salad.", calories: 480, protein: 17, price: 110, isVeg: true, image: photo("photo-1546833999-b9f581a1996d") },
  { dish: "Paneer Butter Masala + Roti", category: "Lunch", description: "Paneer in tomato gravy with two whole-wheat rotis.", calories: 560, protein: 21, price: 135, isVeg: true, image: photo("photo-1631452180519-c014fe946bc7") },
  { dish: "Dal Khichdi", category: "Lunch", description: "Comforting rice and lentils with pickle and papad.", calories: 390, protein: 15, price: 95, isVeg: true, image: photo("photo-1601050690597-df0568f70950") },
  { dish: "South Indian Thali", category: "Lunch", description: "Rice, sambar, rasam, vegetables and papad.", calories: 610, protein: 19, price: 150, isVeg: true, image: photo("photo-1630383249896-424e482df921") },
  { dish: "Fruit Bowl", category: "Snacks", description: "Fresh seasonal fruit finished with lime.", calories: 160, protein: 3, price: 65, isVeg: true, image: photo("photo-1490474418585-ba9bad8fd0ea") },
  { dish: "Sprouts Chaat", category: "Snacks", description: "Moong sprouts with onion, tomato and chaat masala.", calories: 190, protein: 11, price: 60, isVeg: true, image: photo("photo-1540420773420-3366772f4999") },
  { dish: "Dhokla", category: "Snacks", description: "Yellow steamed dhokla with green chutney.", calories: 210, protein: 8, price: 50, isVeg: true, image: photo("photo-1601050690597-df0568f70950") },
  { dish: "Samosa", category: "Snacks", description: "Two crisp samosas with mint chutney.", calories: 280, protein: 5, price: 35, isVeg: true, image: photo("photo-1601050690117-94f5f6fa8bd7") },
];

const MENU = CATALOGUE.map((item) => ({
  ...item,
  menuFamily: menuFamilyFor(item.dish),
  portionKg: CATEGORY_PORTION_KG[item.category] ?? CATEGORY_PORTION_KG.Lunch,
}));

const BY_DISH = new Map(MENU.map((item) => [item.dish, item]));

const CATEGORIES = ["Breakfast", "Lunch", "Snacks"];

const listMenu = () => MENU.map((item) => ({ ...item }));

const dishesFor = (category) => MENU.filter((item) => item.category === category).map((item) => ({ ...item }));

const findDish = (dish) => {
  const found = BY_DISH.get(dish);
  return found ? { ...found } : null;
};

const isKnownDish = (dish) => BY_DISH.has(dish);

/**
 * Portion weight for a dish. Unknown dishes fall back to the lunch weight so a
 * menu addition that has not reached this file still produces a sane kg figure
 * instead of zero, which would silently under-report waste.
 */
const portionKgFor = (dish) => BY_DISH.get(dish)?.portionKg ?? CATEGORY_PORTION_KG.Lunch;

module.exports = { MENU, CATEGORIES, CATEGORY_PORTION_KG, listMenu, dishesFor, findDish, isKnownDish, portionKgFor };

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
 */

const { menuFamilyFor } = require("../menuTaxonomy");

/** Cooked weight per serving, in kg, by meal category. */
const CATEGORY_PORTION_KG = { Breakfast: 0.28, Lunch: 0.42, Snacks: 0.16 };

const CATALOGUE = [
  { dish: "Idli Sambar", category: "Breakfast" },
  { dish: "Masala Dosa", category: "Breakfast" },
  { dish: "Poha", category: "Breakfast" },
  { dish: "Upma", category: "Breakfast" },
  { dish: "Veg Biryani", category: "Lunch" },
  { dish: "Rajma Chawal", category: "Lunch" },
  { dish: "Paneer Butter Masala + Roti", category: "Lunch" },
  { dish: "Dal Khichdi", category: "Lunch" },
  { dish: "South Indian Thali", category: "Lunch" },
  { dish: "Fruit Bowl", category: "Snacks" },
  { dish: "Sprouts Chaat", category: "Snacks" },
  { dish: "Dhokla", category: "Snacks" },
  { dish: "Samosa", category: "Snacks" },
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

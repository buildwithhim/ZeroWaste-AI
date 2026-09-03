/**
 * Maps cafeteria dishes onto the menu families the forecasting model was
 * trained on (see data/history_dataset.csv). Feedback is collected per dish but
 * the model reasons about families, so this is the join between the two.
 */

const DISH_TO_MENU_FAMILY = {
  "Idli Sambar": "South Indian",
  "Masala Dosa": "South Indian",
  Upma: "South Indian",
  "South Indian Thali": "South Indian",
  Poha: "North Indian",
  "Veg Biryani": "Biryani",
  "Rajma Chawal": "North Indian",
  "Paneer Butter Masala + Roti": "North Indian",
  "Dal Khichdi": "North Indian",
  Dhokla: "North Indian",
  Samosa: "North Indian",
  "Fruit Bowl": "Salad",
  "Sprouts Chaat": "Salad",
};

const MENU_FAMILIES = ["Biryani", "Chinese", "Continental", "North Indian", "Salad", "South Indian"];

const menuFamilyFor = (dish) => DISH_TO_MENU_FAMILY[dish] || "North Indian";

module.exports = { DISH_TO_MENU_FAMILY, MENU_FAMILIES, menuFamilyFor };

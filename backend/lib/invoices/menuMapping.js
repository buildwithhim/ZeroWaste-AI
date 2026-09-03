/**
 * Maps SmartQ line items onto the menu families the demand model understands.
 *
 * The model is trained on families (Salad, South Indian, Continental...) while
 * invoices print specific products like "Papaya Cut(200 Gms)". Matching is by
 * keyword rather than an exact lookup because the SmartQ catalogue changes
 * wording often, and an unknown product should still land in a sensible family
 * instead of being dropped from the training data.
 */

const { MENU_FAMILIES } = require("../menuTaxonomy");

/**
 * Ordered rules — the first match wins, so put the specific patterns first.
 * "Fruit Juice" must be tested before the generic "juice" beverage rule.
 */
const RULES = [
  { family: "Salad", pattern: /\bsalad\b|sprout|\bslaw\b/i },
  { family: "Salad", pattern: /fruit|papaya|watermelon|melon|pineapple|banana|apple|guava|platter/i },
  { family: "South Indian", pattern: /idli|dosa|vada|upma|sambar|uttapam|pongal|medu/i },
  { family: "Biryani", pattern: /biryani|biriyani|pulao|pulav/i },
  { family: "Chinese", pattern: /noodle|manchur|schezwan|hakka|fried rice|spring roll|momo/i },
  { family: "Continental", pattern: /sandwich|pasta|burger|pizza|wrap|toast|croissant|muffin|baguette/i },
  { family: "North Indian", pattern: /paneer|roti|naan|dal|rajma|chole|khichdi|thali|curry|sabzi|paratha|samosa|dhokla/i },
];

/** Beverages and fruit are grouped with Salad: both are light, low-waste items. */
const BEVERAGE = /juice|tea|coffee|latte|smoothie|shake|lassi|buttermilk|water/i;

function invoiceMenuFamily(foodItem) {
  const name = String(foodItem || "");

  for (const rule of RULES) {
    if (rule.pattern.test(name)) return rule.family;
  }
  if (BEVERAGE.test(name)) return "Salad";

  // Unmatched products default to the largest family so they still contribute
  // volume rather than vanishing from the dataset.
  return "North Indian";
}

/** Every family an item could be assigned to, for UI filters. */
const families = () => MENU_FAMILIES;

module.exports = { invoiceMenuFamily, families };

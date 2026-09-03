/**
 * Administrator gate for the invoice routes.
 *
 * The implementation lives in lib/requireAdmin.js so the invoice and operations
 * areas cannot drift into two different ideas of what "admin" means. This file
 * only fixes the message, which names the data being protected.
 */

const { adminGate, ADMIN_TOKEN } = require("../requireAdmin");

const requireAdmin = adminGate("Administrator access is required for invoice data");

module.exports = { requireAdmin, ADMIN_TOKEN };
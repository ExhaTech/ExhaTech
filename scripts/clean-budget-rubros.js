/**
 * Yurguen: fuerza migración (rubros → categorías) y limpia rubros en todos los budgets.
 * Uso: node scripts/clean-budget-rubros.js
 */
const fs = require('fs');
const path = require('path');
const budgetStore = require('../lib/budget-store');

const dir = path.join(__dirname, '..', 'data', 'budgets');
if (!fs.existsSync(dir)) {
  console.log('No hay data/budgets');
  process.exit(0);
}

fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .forEach((f) => {
    const userId = f.replace(/\.json$/, '');
    const budget = budgetStore.loadBudget(userId);
    budget.rubros = [];
    budgetStore.saveBudget(userId, budget);
    console.log('OK', userId, '→ categorías:', (budget.categories || []).length);
  });

console.log('Listo. Reiniciá el server.');

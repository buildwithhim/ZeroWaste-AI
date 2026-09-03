/**
 * Thin wrapper around backend/predict.py.
 *
 * The planner needs one forecast per menu family on the board, so it always
 * uses the batch path: a single Python process loads the model and encoders
 * once and answers every family, instead of paying that cost per dish.
 */

const { spawn } = require("child_process");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..", "..");
const PYTHON_PATH = () => process.env.PYTHON_PATH || path.join(BACKEND_DIR, "..", ".venv", "Scripts", "python.exe");

/** Resolves with a Map keyed by menu family. Rejects if the predictor fails. */
function predictFamilies(weekday, families) {
  const unique = [...new Set(families)];
  if (!unique.length) return Promise.resolve(new Map());

  return new Promise((resolve, reject) => {
    const python = spawn(PYTHON_PATH(), ["predict.py", "--batch"], { cwd: BACKEND_DIR });
    let output = "";
    let error = "";

    python.stdout.on("data", (chunk) => (output += chunk.toString()));
    python.stderr.on("data", (chunk) => (error += chunk.toString()));
    python.on("error", reject);
    python.on("close", (code) => {
      if (code !== 0) return reject(new Error(error.trim() || `predict.py exited with code ${code}`));

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        return reject(new Error(`Unreadable predictor output: ${output.slice(0, 400)}`));
      }

      if (parsed.error) return reject(new Error(parsed.error));
      resolve(new Map((parsed.predictions || []).map((row) => [row.menu, row])));
    });

    python.stdin.write(JSON.stringify(unique.map((menu) => ({ weekday, menu }))));
    python.stdin.end();
  });
}

module.exports = { predictFamilies };

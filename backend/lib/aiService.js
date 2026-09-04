/**
 * The one place that knows how to reach the Python side.
 *
 * Two transports, one interface:
 *
 *   spawn  Runs backend/predict.py or backend/parse_invoices.py as a child
 *          process. This is what development and the entire test suite use,
 *          and it stays the default so neither changes.
 *
 *   http   Calls the containerised AI service. Selected automatically when
 *          AI_SERVICE_URL is set, which is how production is configured.
 *
 * WHY BOTH
 * --------
 * The spawn path is genuinely better for development: there is nothing to start
 * and a change to predict.py takes effect on the next request. It is genuinely
 * worse in production, where it reloads the model on every call and forces a
 * Python runtime into the Node image. Keeping both means the deployment change
 * did not have to be paid for with a rewrite of 361 backend tests, and the
 * production shape is still the right one.
 *
 * The interpreter path used to be resolved independently in predictor.js,
 * ingest.js and server.js, each defaulting to `<repo>/.venv/Scripts/python.exe`
 * -- a Windows path that does not exist in a Linux container, which is why CI
 * had to set PYTHON_PATH explicitly. It is resolved once, here.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { readConfig } = require("./config");
const { logger } = require("./logger");

const BACKEND_DIR = path.join(__dirname, "..");

/**
 * Locates a Python interpreter.
 *
 * PYTHON_PATH wins. Otherwise a repository virtualenv is used if one exists --
 * checking both layouts, because the Scripts/ directory is Windows-only and the
 * previous hardcoded default silently failed everywhere else. Failing that,
 * `python3` from PATH, which is what a container has.
 */
function resolvePythonPath(config = readConfig()) {
  if (config.ai.pythonPath) return config.ai.pythonPath;

  const candidates = [
    path.join(BACKEND_DIR, "..", ".venv", "Scripts", "python.exe"),
    path.join(BACKEND_DIR, "..", ".venv", "bin", "python"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return process.platform === "win32" ? "python" : "python3";
}

/** Runs a Python script, writing `input` to stdin and parsing JSON from stdout. */
function runScript(script, args, input, config) {
  return new Promise((resolve, reject) => {
    const python = spawn(resolvePythonPath(config), [script, ...args], { cwd: BACKEND_DIR });
    let output = "";
    let error = "";

    python.stdout.on("data", (chunk) => (output += chunk.toString()));
    python.stderr.on("data", (chunk) => (error += chunk.toString()));
    python.on("error", reject);
    python.on("close", (code) => {
      if (code !== 0) return reject(new Error(error.trim() || `${script} exited with code ${code}`));

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        return reject(new Error(`Unreadable ${script} output: ${output.slice(0, 400)}`));
      }

      if (parsed.error) return reject(new Error(parsed.error));
      resolve(parsed);
    });

    if (input !== undefined) {
      python.stdin.write(JSON.stringify(input));
    }
    python.stdin.end();
  });
}

/** POSTs JSON to the AI service, with a timeout so a hung service is not a hung request. */
async function post(pathname, body, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  try {
    const response = await fetch(`${config.ai.url.replace(/\/+$/, "")}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI service returned ${response.status} for ${pathname}: ${detail.slice(0, 300)}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`AI service did not respond to ${pathname} within ${config.ai.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** One forecast. */
async function predictOne(weekday, menu, config = readConfig()) {
  if (config.ai.mode === "http") return post("/predict", { weekday, menu }, config);
  return runScript("predict.py", [weekday, menu], undefined, config);
}

/** Many forecasts from one model load. Returns the raw `{ predictions: [...] }`. */
async function predictBatch(requests, config = readConfig()) {
  if (!requests.length) return { predictions: [] };
  if (config.ai.mode === "http") return post("/predict/batch", { requests }, config);
  return runScript("predict.py", ["--batch"], requests, config);
}

/**
 * Extracts fields from invoice PDFs.
 *
 * The two transports need different inputs and this is the only place that
 * difference exists: the spawn path passes filesystem paths, because the
 * extractor and the caller share a disk, while the HTTP path sends the bytes,
 * because they do not.
 */
async function extractInvoices(files, config = readConfig()) {
  if (config.ai.mode === "http") {
    const payload = files.map((file) => ({
      id: file.id,
      contentBase64: (file.buffer ?? fs.readFileSync(file.path)).toString("base64"),
    }));
    const parsed = await post("/extract", { files: payload }, config);
    return parsed.results || [];
  }

  const parsed = await runScript(
    path.join(BACKEND_DIR, "parse_invoices.py"),
    [],
    { files: files.map((file) => ({ id: file.id, path: file.path })) },
    config
  );
  return parsed.results || [];
}

/**
 * Readiness check.
 *
 * In spawn mode there is no service to reach, so the check confirms the
 * interpreter exists and the model artefacts are on disk -- the two things
 * whose absence turns every forecast into a 500.
 */
async function checkHealth(config = readConfig()) {
  const startedAt = Date.now();

  if (config.ai.mode === "http") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(config.ai.timeoutMs, 5000));
      const response = await fetch(`${config.ai.url.replace(/\/+$/, "")}/health/ready`, { signal: controller.signal });
      clearTimeout(timer);

      return response.ok
        ? { name: "ai-service", status: "ok", latencyMs: Date.now() - startedAt }
        : { name: "ai-service", status: "error", detail: `readiness returned ${response.status}`, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { name: "ai-service", status: "error", detail: error.message, latencyMs: Date.now() - startedAt };
    }
  }

  const { dataPath } = require("./dataDir");
  const missing = ["model.pkl", "day_encoder.pkl", "menu_encoder.pkl"].filter((file) => !fs.existsSync(dataPath(file)));

  if (missing.length) {
    return { name: "ai-service", status: "error", detail: `missing model artefacts: ${missing.join(", ")}` };
  }

  return { name: "ai-service", status: "ok", detail: `spawn:${resolvePythonPath(config)}` };
}

module.exports = { predictOne, predictBatch, extractInvoices, checkHealth, resolvePythonPath };

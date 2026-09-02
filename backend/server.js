const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(cors());

app.get("/forecast", (req, res) => {
  const weekday = req.query.day || "Friday";
  const menu = req.query.menu || "Biryani";

  const pythonPath = path.join(
    __dirname,
    "..",
    ".venv",
    "Scripts",
    "python.exe"
  );

  const py = spawn(pythonPath, ["predict.py", weekday, menu], {
    cwd: __dirname,
  });

  let output = "";
  let error = "";

  py.stdout.on("data", (data) => {
    output += data.toString();
  });

  py.stderr.on("data", (data) => {
    error += data.toString();
  });

  py.on("close", (code) => {
    if (code !== 0) {
      console.error(error);
      return res.status(500).json({ error });
    }

    const result = JSON.parse(output);

    res.json({
      predictedOrders: result.prediction,
      confidence: 94,
      foodSavedKg: Math.round(result.prediction * 0.053),
      workerMeals: Math.round(result.prediction * 0.106),
    });
  });
});

app.listen(5000, () => {
  console.log("Backend running at http://localhost:5000");
});
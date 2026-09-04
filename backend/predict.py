"""Stages 2 and 8 of the loop: predict demand, then adjust it with what the last
round of feedback taught us.

The model itself still answers a single question -- how many people order this
menu on this weekday. Portion feedback does not change how many people show up,
so it is applied as a separate multiplier that converts predicted orders into a
recommended number of servings to cook. Keeping the two apart means the learned
signal stays visible and reversible instead of being smeared into the forecast.
"""

import json
import os
import sys

import joblib
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Mirrors backend/lib/dataDir.js so Node and Python always agree on where
# runtime state lives -- the test harness points both at one temp directory.
DATA_DIR = os.environ.get("ZEROWASTE_DATA_DIR") or os.path.join(BASE_DIR, "..", "data")
SIGNALS_PATH = os.path.join(DATA_DIR, "feedback_signals.json")

MIN_SIGNAL_SAMPLE = 4

model = joblib.load(os.path.join(DATA_DIR, "model.pkl"))
day_encoder = joblib.load(os.path.join(DATA_DIR, "day_encoder.pkl"))
menu_encoder = joblib.load(os.path.join(DATA_DIR, "menu_encoder.pkl"))


def load_signals():
    """Aggregated feedback written by backend/lib/signals.js. Never identity-bearing."""
    try:
        with open(SIGNALS_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def resolve_multiplier(signals, menu, weekday):
    """Pick the most specific trustworthy signal: menu family, then weekday, then global.

    Returns (multiplier, responses, reason).
    """
    if not signals or not signals.get("totalResponses"):
        return 1.0, 0, "No feedback collected yet"

    family = (signals.get("byMenuFamily") or {}).get(menu)
    if family and family.get("responses", 0) >= MIN_SIGNAL_SAMPLE:
        return (
            float(family["portionMultiplier"]),
            int(family["responses"]),
            "{0} responses for {1} (avg leftover {2}%)".format(
                family["responses"], menu, family["averageLeftoverRate"]
            ),
        )

    day = (signals.get("byWeekday") or {}).get(weekday)
    if day and day.get("responses", 0) >= MIN_SIGNAL_SAMPLE:
        return (
            float(day["portionMultiplier"]),
            int(day["responses"]),
            "{0} responses for {1}".format(day["responses"], weekday),
        )

    global_signal = signals.get("global") or {}
    total = int(signals.get("totalResponses", 0))
    return (
        float(global_signal.get("portionMultiplier", 1.0)),
        total,
        "{0} responses across all dishes".format(total),
    )


def safe_encode(encoder, value, fallback_index=0):
    """Encoders only know the classes present at training time."""
    if value in list(encoder.classes_):
        return int(encoder.transform([value])[0])
    return fallback_index


def predict_one(weekday, menu):
    """Model prediction plus the feedback adjustment for one weekday/menu pair."""
    features = pd.DataFrame(
        {
            "weekday": [safe_encode(day_encoder, weekday)],
            "menu": [safe_encode(menu_encoder, menu)],
        }
    )

    base_prediction = int(round(model.predict(features)[0]))

    signals = load_signals()
    multiplier, responses, reason = resolve_multiplier(signals, menu, weekday)
    recommended_servings = int(round(base_prediction * multiplier))

    # Confidence rises with the volume of feedback backing the adjustment.
    confidence = 94 if responses == 0 else min(99, 88 + round(responses / (responses + 12.0) * 11))

    return {
        "weekday": weekday,
        "menu": menu,
        "prediction": base_prediction,
        "basePrediction": base_prediction,
        "portionMultiplier": round(multiplier, 3),
        "recommendedServings": recommended_servings,
        "feedbackResponses": responses,
        "feedbackApplied": responses > 0 and multiplier != 1.0,
        "adjustmentReason": reason,
        "confidence": int(confidence),
    }


def run_batch():
    """Dish-level planning needs one forecast per menu family on the board.

    Spawning a Python process per dish would mean re-loading the model and both
    encoders a dozen times to render a single page, so the batch path takes a
    JSON array of {weekday, menu} pairs on stdin and answers them all from the
    one already-loaded model.
    """
    try:
        requests = json.loads(sys.stdin.read() or "[]")
    except ValueError as error:
        print(json.dumps({"error": "invalid JSON on stdin: {0}".format(error)}))
        return 1

    if not isinstance(requests, list):
        print(json.dumps({"error": "expected a JSON array of {weekday, menu} objects"}))
        return 1

    results = []
    for item in requests:
        if not isinstance(item, dict):
            continue
        results.append(predict_one(item.get("weekday") or "Friday", item.get("menu") or "Biryani"))

    print(json.dumps({"predictions": results}))
    return 0


def main():
    if "--batch" in sys.argv[1:]:
        return run_batch()

    weekday = sys.argv[1] if len(sys.argv) > 1 else "Friday"
    menu = sys.argv[2] if len(sys.argv) > 2 else "Biryani"
    print(json.dumps(predict_one(weekday, menu)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

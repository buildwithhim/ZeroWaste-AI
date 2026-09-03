"""Stage 7 (offline): retrain the demand model and report the learned portion signal.

WHY PORTION FEEDBACK IS NOT FOLDED INTO THE TRAINING TARGET
----------------------------------------------------------
The two halves of the loop answer different questions:

  * the model answers "how many people will order this menu on this weekday?"
  * portion feedback answers "how much should we serve each of them?"

Someone leaving half a plate does not mean fewer people turned up, so shrinking
the historical order counts would corrupt the demand signal. It would also
double-count: backend/predict.py already multiplies the model's output by the
portion multiplier at inference time. Applying the correction here as well
would compound it every retrain and steadily starve the kitchen.

So this script trains on true historical demand and prints the current portion
signal alongside it, keeping the two corrections separate and auditable.

Run with:  python train_model.py
"""

import json
import os

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import LabelEncoder

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
SIGNALS_PATH = os.path.join(DATA_DIR, "feedback_signals.json")


def load_signals():
    try:
        with open(SIGNALS_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def report_portion_signal(signals):
    """Show what the serving side of the loop has learned, per menu family."""
    if not signals or not signals.get("totalResponses"):
        print("No feedback signals yet - forecasts will run unadjusted.")
        return

    global_signal = signals.get("global") or {}
    print(
        "Portion signal from {0} responses: global multiplier {1} "
        "(satisfaction {2}%, leftover {3}%).".format(
            signals["totalResponses"],
            global_signal.get("portionMultiplier", 1.0),
            global_signal.get("portionSatisfaction", 0),
            global_signal.get("averageLeftoverRate", 0),
        )
    )

    for family, stats in sorted((signals.get("byMenuFamily") or {}).items()):
        if stats.get("responses", 0) == 0:
            continue
        print(
            "  {0:<14} x{1:<6} from {2:>4} responses (leftover {3}%)".format(
                family,
                stats.get("portionMultiplier", 1.0),
                stats.get("responses", 0),
                stats.get("averageLeftoverRate", 0),
            )
        )


def main():
    df = pd.read_csv(os.path.join(DATA_DIR, "history_dataset.csv"))

    day = LabelEncoder()
    menu = LabelEncoder()

    features = pd.DataFrame(
        {
            "weekday": day.fit_transform(df["weekday"]),
            "menu": menu.fit_transform(df["menu"]),
        }
    )
    target = df["orders"]

    model = RandomForestRegressor(random_state=42)
    scores = cross_val_score(model, features, target, cv=min(5, len(df)), scoring="r2")
    model.fit(features, target)

    joblib.dump(model, os.path.join(DATA_DIR, "model.pkl"))
    joblib.dump(day, os.path.join(DATA_DIR, "day_encoder.pkl"))
    joblib.dump(menu, os.path.join(DATA_DIR, "menu_encoder.pkl"))

    print("Demand model ready on {0} rows. Cross-validated R2: {1:.3f}".format(len(df), scores.mean()))
    report_portion_signal(load_signals())


if __name__ == "__main__":
    main()

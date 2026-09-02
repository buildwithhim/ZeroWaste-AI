import joblib
import pandas as pd
import json
import sys

model = joblib.load("../data/model.pkl")
day = joblib.load("../data/day_encoder.pkl")
menu = joblib.load("../data/menu_encoder.pkl")

X = pd.DataFrame({
    "weekday": [day.transform([sys.argv[1]])[0]],
    "menu": [menu.transform([sys.argv[2]])[0]]
})

prediction = round(model.predict(X)[0])

print(json.dumps({"prediction": int(prediction)}))
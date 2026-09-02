import pandas as pd
import joblib

from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder

df=pd.read_csv("../data/history_dataset.csv")

day=LabelEncoder()
menu=LabelEncoder()

df["weekday"]=day.fit_transform(df["weekday"])
df["menu"]=menu.fit_transform(df["menu"])

X=df[["weekday","menu"]]
y=df["orders"]

model=RandomForestRegressor(random_state=42)
model.fit(X,y)

joblib.dump(model,"../data/model.pkl")
joblib.dump(day,"../data/day_encoder.pkl")
joblib.dump(menu,"../data/menu_encoder.pkl")

print("Model Ready")
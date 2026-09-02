import pandas as pd
import random
from datetime import datetime, timedelta

menus=["Biryani","North Indian","Chinese","Salad","South Indian","Continental"]

rows=[]

d=datetime(2026,5,1)

for i in range(120):
    day=d+timedelta(days=i)

    if day.weekday()>4:
        continue

    base={0:340,1:330,2:325,3:335,4:300}[day.weekday()]
    menu=random.choice(menus)

    if menu=="Biryani":
        base+=30
    if menu=="Salad":
        base-=20

    rows.append({
        "weekday":day.strftime("%A"),
        "menu":menu,
        "orders":base+random.randint(-15,15)
    })

pd.DataFrame(rows).to_csv("../data/history_dataset.csv",index=False)
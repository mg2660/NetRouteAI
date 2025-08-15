import pandas as pd
import glob
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

# === Load latest N CSV files ===
NUM_RECENT = 20
files = sorted(glob.glob("csv-data/link_data_*.csv"), reverse=True)[:NUM_RECENT]
df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)

# === Define Features & Target ===
features = [
    'cpu_source', 'cpu_target',
    'mem_source', 'mem_target',
    'packet_loss_rate', 'bandwidth_mbps',
    'alarm_status_source', 'alarm_status_target'  # New features
]

target = 'latency_ms'

# === Drop NaN and filter bad data ===
df = df.dropna(subset=features + [target])
df = df[(df[features] >= 0).all(axis=1)]  # optional: remove invalid rows

X = df[features]
y = df[target]

# === Train-Test Split ===
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# === Train the Model ===
model = XGBRegressor(n_estimators=150, max_depth=6, learning_rate=0.1)
model.fit(X_train, y_train)

# === Evaluate the Model ===
y_pred = model.predict(X_test)
mae = mean_absolute_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print("MAE:", mae)
print("R2 Score:", r2)

# === Save the Trained Model ===
joblib.dump(model, "models/xgb_latency_model.pkl")
print("✅ Model saved to ml/xgb_latency_model.pkl")

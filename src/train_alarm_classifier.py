#training for latency prediction
import pandas as pd
import glob
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

# Load latest N node CSVs
NUM_RECENT = 20
files = sorted(glob.glob("csv-data/node_data_*.csv"), reverse=True)[:NUM_RECENT]
df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)

# Preprocess
df = df.dropna(subset=['cpu_usage', 'memory_usage', 'latency_avg', 'packet_loss_rate', 'alarm_status'])
df = df[(df[['cpu_usage', 'memory_usage', 'latency_avg', 'packet_loss_rate']] >= 0).all(axis=1)]

# Map alarm_status to integer labels
alarm_map = {'GREEN': 0, 'YELLOW': 1, 'RED': 2}
df['alarm_label'] = df['alarm_status'].map(alarm_map)

X = df[['cpu_usage', 'memory_usage', 'latency_avg', 'packet_loss_rate']]
y = df['alarm_label']

# Split & train
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
model = XGBClassifier(n_estimators=100, max_depth=5)
model.fit(X_train, y_train)

# Evaluate
y_pred = model.predict(X_test)
print(classification_report(y_test, y_pred, target_names=alarm_map.keys()))

# Save model
joblib.dump(model, "models/xgb_alarm_model.pkl")
print("✅ Alarm status classifier saved.")


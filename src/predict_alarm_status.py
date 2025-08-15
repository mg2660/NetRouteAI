import json
import joblib
import numpy as np
import time
import sys
sys.stdout.reconfigure(encoding='utf-8')

# Load model
model = joblib.load("models/xgb_alarm_model.pkl")
reverse_alarm_map = {0: "GREEN", 1: "YELLOW", 2: "RED"}
# Alarm status encoding
alarm_map = {"GREEN": 0, "YELLOW": 1, "RED": 2}

INTERVAL_SECONDS = 5
RUN_DURATION_SECONDS = 10 * 60  # 10 minutes

start_time = time.time()
while time.time() - start_time < RUN_DURATION_SECONDS:
    try:
        # Load graph
        with open("static/graph-data/graph_live.json") as f:
            graph = json.load(f)

        # Predict alarm status for each node
        for node in graph["nodes"]:
            p = node.get("properties", {})
            features = [
                p.get("cpu_usage", 0),
                p.get("memory_usage", 0),
                p.get("latency_avg", 0),
                p.get("packet_loss_rate", 0)
            ]
            pred = model.predict([features])[0]
            node["properties"]["predicted_alarm_status"] = reverse_alarm_map[pred]

        # Save updated graph
        with open("static/graph-data/graph_live_alarm_predicted.json", "w") as f:
            json.dump(graph, f, indent=2)

        print(f"✅ [{time.strftime('%H:%M:%S')}] Predictions updated.")
    
    except Exception as e:
        print(f"❗ Error during prediction: {e}")

    time.sleep(INTERVAL_SECONDS)

print("🛑 Prediction loop ended after 10 minutes.")
         

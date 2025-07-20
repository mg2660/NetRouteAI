import json
import joblib
import time
import sys
sys.stdout.reconfigure(encoding='utf-8')

# Load model once
model = joblib.load("ml/xgb_latency_model.pkl")

# Alarm status encoding
alarm_map = {"GREEN": 0, "YELLOW": 1, "RED": 2}

INTERVAL_SECONDS = 5
RUN_DURATION_SECONDS = 10 * 60  # 10 minutes

start_time = time.time()

print("🔁 Starting latency prediction loop...")

while time.time() - start_time < RUN_DURATION_SECONDS:
    try:
        # Load graph-live.json
        with open("graph-data/graph_live.json") as f:
            graph = json.load(f)

        node_map = {n["id"]: n for n in graph["nodes"]}

        for link in graph["links"]:
            src = node_map.get(link["source"], {}).get("properties", {})
            tgt = node_map.get(link["target"], {}).get("properties", {})

            if not src or not tgt:
                continue

            features = [
                src.get("cpu_usage", 0),
                tgt.get("cpu_usage", 0),
                src.get("memory_usage", 0),
                tgt.get("memory_usage", 0),
                (src.get("packet_loss_rate", 0) + tgt.get("packet_loss_rate", 0)) / 2,
                alarm_map.get(src.get("alarm_status", "GREEN"), 0),
                alarm_map.get(tgt.get("alarm_status", "GREEN"), 0),
                link["properties"].get("bandwidth_mbps", 100)
            ]

            predicted_latency = model.predict([features])[0]
            link["properties"]["predicted_latency_ms"] = float(round(predicted_latency, 2))

        with open("graph-data/graph_live_predicted.json", "w") as f:
            json.dump(graph, f, indent=2)

        print(f"✅ [{time.strftime('%H:%M:%S')}] Predictions updated.")
    
    except Exception as e:
        print(f"❗ Error during prediction: {e}")

    time.sleep(INTERVAL_SECONDS)

print("🛑 Prediction loop ended after 10 minutes.")

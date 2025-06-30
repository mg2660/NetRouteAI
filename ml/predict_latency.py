# ml/predict_latency.py
import json
import joblib
import numpy as np

# Load trained model
model = joblib.load("ml/xgb_latency_model.pkl")

# Alarm status mapping
alarm_map = {"GREEN": 0, "YELLOW": 1, "RED": 2}

# Load graph
with open("graph-data/graph_live.json") as f:
    graph = json.load(f)

# Helper to find node by ID
node_map = {n["id"]: n for n in graph["nodes"]}

predictions = []

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

    # Predict latency
    predicted_latency = model.predict([features])[0]

    # Store prediction
    link["properties"]["predicted_latency_ms"] = float(round(predicted_latency, 2))


# Save updated graph
with open("graph-data/graph_live_predicted.json", "w") as f:
    json.dump(graph, f, indent=2)

print("✅ Predicted latencies written to graph_live_predicted.json")

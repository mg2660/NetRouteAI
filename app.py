from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import subprocess
import os, json, networkx as nx
from threading import Lock

ai_process = None
ai_process_lock = Lock()


app = Flask(__name__)
CORS(app)

GRAPH_DIR = os.path.join("static", "graph-data")

@app.route("/ai-analysis/start", methods=["POST"])
def start_ai_analysis():
    global ai_process
    with ai_process_lock:
        if ai_process is None or ai_process.poll() is not None:
            ai_process = subprocess.Popen(["python", "src/aiAnalysis.py"], shell=True)
            return jsonify({"status": "started"}), 200
        else:
            return jsonify({"status": "already running"}), 200

@app.route("/ai-analysis/stop", methods=["POST"])
def stop_ai_analysis():
    global ai_process
    with ai_process_lock:
        if ai_process and ai_process.poll() is None:
            ai_process.terminate()
            ai_process.wait()
            ai_process = None
            return jsonify({"status": "stopped"}), 200
        else:
            return jsonify({"status": "not running"}), 200

def health_to_penalty(status):
    return {"GREEN": 0.0, "YELLOW": 0.5, "RED": 1.0}.get(status, 1.0)

def launch_background_scripts():
    print("🚀 Launching mock data scripts in background...")
    subprocess.Popen(["node", "src/patterned_mock_graph_generator.js"], shell=True)
    subprocess.Popen(["python", "src/predict_latency.py"], shell=True)
    subprocess.Popen(["python", "src/predict_alarm_status.py"], shell=True)

# ✅ Run once at app startup
with app.app_context():
    launch_background_scripts()

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/predict-path", methods=["POST"])
def predict_path():
    print("POST /predict-path called")
    data = request.get_json()
    source = data.get("source")
    target = data.get("target")
    strategy = data.get("strategy", "best")

    try:
        with open(os.path.join(GRAPH_DIR, "graph_live_predicted.json")) as f:
            latency_data = json.load(f)
        with open(os.path.join(GRAPH_DIR, "graph_live_alarm_predicted.json")) as f:
            alarm_data = json.load(f)
    except Exception as e:
        return jsonify({"error": f"Error reading files: {str(e)}"}), 500

    health_map = {
        node["id"]: node["properties"].get("predicted_alarm_status", "RED")
        for node in alarm_data["nodes"]
    }

    G = nx.DiGraph()
    for link in latency_data.get("links", []):
        src = link["source"]
        tgt = link["target"]
        latency = link["properties"].get("predicted_latency_ms", 9999)
        G.add_edge(src, tgt, latency=latency)

    unhealthy_nodes = {node_id for node_id, status in health_map.items() if status == "RED"}
    G.remove_nodes_from(unhealthy_nodes)

    if not G.has_node(source) or not G.has_node(target):
        return jsonify({"error": "Invalid source or target"}), 400

    try:
        if strategy == "hops":
            path = nx.shortest_path(G, source=source, target=target)
            total_latency = sum(G[path[i]][path[i + 1]]['latency'] for i in range(len(path) - 1))
            return jsonify({
                "paths": [{"path": path, "latency": round(total_latency, 2)}],
                "message": "Shortest path by hops (excluding RED nodes)"
            })

        elif strategy == "latency":
            path = nx.shortest_path(G, source=source, target=target, weight="latency")
            total_latency = sum(G[path[i]][path[i + 1]]['latency'] for i in range(len(path) - 1))
            return jsonify({
                "paths": [{"path": path, "latency": round(total_latency, 2)}],
                "message": "Lowest latency path (excluding RED nodes)"
            })

        elif strategy in ["risk", "best"]:
            max_cutoff = 9
            paths = []
            used_cutoff = None

            for cutoff in range(2, max_cutoff + 1):
                try:
                    paths = list(nx.all_simple_paths(G, source, target, cutoff=cutoff))
                    if paths:
                        used_cutoff = cutoff
                        break
                except nx.NetworkXNoPath:
                    continue

            if not paths:
                return jsonify({
                    "paths": [],
                    "message": "No valid paths found",
                    "cutoff_used": None
                })

            max_latency = max((G[u][v]['latency'] for u, v in G.edges), default=1)
            result = []
            for path in paths:
                total_latency = sum(G[path[i]][path[i + 1]]['latency'] for i in range(len(path) - 1))
                normalized_latency = total_latency / max_latency
                avg_health_penalty = sum(health_to_penalty(health_map.get(node, "RED")) for node in path) / len(path)
                risk_score = round(0.5 * normalized_latency + 0.5 * avg_health_penalty, 3)
                result.append({
                    "path": path,
                    "latency": round(total_latency, 2),
                    "health_penalty": round(avg_health_penalty, 2),
                    "risk_score": risk_score
                })

            result.sort(key=lambda x: x["risk_score"])
            return jsonify({
                "paths": result[:5],
                "cutoff_used": used_cutoff,
                "message": f"Lowest risk path using cutoff {used_cutoff}"
            })

        else:
            return jsonify({"error": f"Unknown strategy: {strategy}"}), 400

    except Exception as e:
        return jsonify({"error": f"Error computing path: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True)

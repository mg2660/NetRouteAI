import subprocess
import os

def run_js_generator():
    print("🔁 Generating live graph from JS...")
    subprocess.run(["node", "src/pattern_mock_graph_generator.js"], check=True)

def run_latency_prediction():
    print("⚙️ Running latency prediction...")
    subprocess.run(["python", "src/predict_latency.py"], check=True)

def run_alarm_prediction():
    print("⚠️ Running alarm status prediction...")
    subprocess.run(["python", "src/predict_alarm_status.py"], check=True)

if __name__ == "__main__":
    try:
        run_js_generator()
        run_latency_prediction()
        run_alarm_prediction()
        print("✅ All graph data generated inside static/graph-data/")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to generate startup data: {e}")

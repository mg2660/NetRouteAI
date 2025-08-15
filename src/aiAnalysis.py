from flask import Flask, jsonify
from flask_socketio import SocketIO
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import json
import os
import time
import threading

print(">>> aiAnalysis.py started")

app = Flask(__name__, static_url_path='/static')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

DATA_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'static', 'graph-data'))
FILES = {
    'real': os.path.join(DATA_FOLDER, 'graph_live.json'),
    'pred_latency': os.path.join(DATA_FOLDER, 'graph_live_predicted.json'),
    'pred_alarm': os.path.join(DATA_FOLDER, 'graph_live_alarm_predicted.json'),
}

# ensure data folder exists (fail early if not)
if not os.path.isdir(DATA_FOLDER):
    print(f"[WARN] DATA_FOLDER does not exist: {DATA_FOLDER}")

# Global to only emit when data changes
_last_emitted_hash = None
_last_emit_lock = threading.Lock()


def wait_for_stable_file(path, timeout=2.0, interval=0.1):
    """
    Wait until file size is stable for two successive checks or until timeout.
    Returns True if stable, False on timeout or missing file.
    """
    start = time.time()
    try:
        last_size = os.path.getsize(path)
    except Exception:
        return False
    while time.time() - start < timeout:
        time.sleep(interval)
        try:
            size = os.path.getsize(path)
        except Exception:
            return False
        if size == last_size:
            # confirm twice to be safer
            time.sleep(interval)
            try:
                size2 = os.path.getsize(path)
            except Exception:
                return False
            if size2 == last_size:
                return True
            last_size = size2
        else:
            last_size = size
    return False


# Safe JSON loader with retry + stability check
def safe_json_load(path, retries=6, delay=0.2):
    if not os.path.isfile(path):
        print(f"[INFO] JSON file missing: {path}")
        return {}

    # Wait until file size is stable (helps if writer is mid-write)
    stable = wait_for_stable_file(path, timeout=2.0, interval=0.1)
    if not stable:
        # still try reading with retries; it may still be OK
        print(f"[WARN] file not stable before read: {path}")

    for attempt in range(1, retries + 1):
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            # quick sanity: empty file -> skip
            if not text.strip():
                raise ValueError("empty file")
            # Attempt to parse
            return json.loads(text)
        except json.JSONDecodeError as e:
            print(f"[JSON ERROR] {path} invalid JSON (attempt {attempt}/{retries}): {e}")
            time.sleep(delay)
        except ValueError as e:
            # empty file case
            print(f"[VALUE ERROR] {path} read issue (attempt {attempt}/{retries}): {e}")
            time.sleep(delay)
        except Exception as e:
            print(f"[ERROR] Could not load {path} (attempt {attempt}/{retries}): {e}")
            return {}
    print(f"[FAIL] Failed to read valid JSON from {path} after {retries} attempts")
    return {}


@app.route('/ai-analysis')
def ai_analysis():
    return jsonify(compute_ai_analysis())


def compute_ai_analysis():
    real_data = safe_json_load(FILES['real'])
    pred_latency_data = safe_json_load(FILES['pred_latency'])
    pred_alarm_data = safe_json_load(FILES['pred_alarm'])

    # normalize node list -> dict mapping id -> properties
    def nodes_to_map(data):
        out = {}
        nodes = data.get('nodes') if isinstance(data, dict) else None
        if not nodes:
            return out
        for node in nodes:
            nid = node.get('id')
            props = node.get('properties', {}) if isinstance(node, dict) else {}
            if nid is not None:
                out[nid] = props
        return out

    real_nodes = nodes_to_map(real_data)
    pred_nodes = nodes_to_map(pred_alarm_data)
    real_links = real_data.get('links', []) if isinstance(real_data, dict) else []
    pred_links = pred_latency_data.get('links', []) if isinstance(pred_latency_data, dict) else []

    def average_latency(links, node_id, key):
        latencies = []
        for link in links:
            # defensive access - links might be dicts but not have expected keys
            source = link.get('source')
            target = link.get('target')
            props = link.get('properties', {}) if isinstance(link, dict) else {}
            if source == node_id or target == node_id:
                lat = None
                # guard when the property might be nested or string numeric
                if isinstance(props, dict):
                    lat = props.get(key)
                if lat is None:
                    # attempt to convert string numbers to float
                    raw = props.get(key) if isinstance(props, dict) else None
                    try:
                        lat = float(raw) if raw is not None else None
                    except Exception:
                        lat = None
                if lat is not None:
                    try:
                        latencies.append(float(lat))
                    except Exception:
                        pass
        return round(sum(latencies) / len(latencies), 2) if latencies else None

    all_node_ids = set(list(real_nodes.keys()) + list(pred_nodes.keys()))
    result = []

    for node_id in sorted(all_node_ids, key=lambda x: str(x)):
        real_node = real_nodes.get(node_id, {})
        pred_node = pred_nodes.get(node_id, {})

        result.append({
            "node": node_id,
            "real_latency": average_latency(real_links, node_id, "latency_ms"),
            "predicted_latency": average_latency(pred_links, node_id, "predicted_latency_ms"),
            "real_alarm": real_node.get("alarm_status", "UNKNOWN"),
            "predicted_alarm": pred_node.get("predicted_alarm_status", "UNKNOWN")
        })

    return result


@socketio.on('connect')
def handle_connect():
    print('Client connected')


class FileChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        # We only care about JSON files in our folder
        if event.is_directory:
            return
        src = os.path.abspath(event.src_path)
        if not src.endswith('.json'):
            return
        if not src.startswith(os.path.abspath(DATA_FOLDER)):
            return

        print(f"[Watcher] File changed: {src}")
        # debounce short bursts
        time.sleep(0.25)

        try:
            data = compute_ai_analysis()

            # Only emit if changed (reduce noise and duplicate malformed sends)
            global _last_emitted_hash
            # canonical hash: sorted JSON string
            try:
                canonical = json.dumps(data, sort_keys=True)
            except Exception:
                canonical = str(data)

            with _last_emit_lock:
                if canonical == _last_emitted_hash:
                    print("[Watcher] No change in computed data -> skipping emit")
                    return
                _last_emitted_hash = canonical

            print("[Watcher] Emitting dataUpdate event to clients")
            # emit the data (SocketIO will JSONify)
            socketio.emit('dataUpdate', data)
        except Exception as e:
            print(f"[Watcher Error] During file analysis: {e}")


def start_watcher():
    event_handler = FileChangeHandler()
    observer = Observer()
    observer.schedule(event_handler, path=DATA_FOLDER, recursive=False)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == '__main__':
    print(">>> Starting file watcher thread...")
    watcher_thread = threading.Thread(target=start_watcher)
    watcher_thread.daemon = True
    watcher_thread.start()
    print(">>> File watcher started")
    print(">>> Starting SocketIO server...")
    socketio.run(app, host='0.0.0.0', port=5050, debug=False)

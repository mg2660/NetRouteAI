# NetRouteAI — Optimising Network Paths with AI

NetRouteAI simulates a real-life 5G network topology and, using ML models trained on simulated datasets, predicts **node health** and **link latency**. 
It includes a real-time D3.js dashboard and computes paths in real time using four strategies: **Lowest Risk**, **Fastest (Latency)**, **Least Hops**, and **Best (Hybrid)**.

---

## ✨ Features
- Real-time 5G-like topology simulation (gNB, CORE_DC, EDGE_DC, FIREWALL, etc.).
- Live metrics per node/link (CPU, memory, latency, packet loss) with smoothing & spikes.
- ML training & prediction:
  - **Latency** via XGBoost Regressor.
  - **Node health / alarm** via classifiers (e.g., RandomForest/XGBoost).
- D3.js topology visualization with health & latency overlays (predicted + real).
- Real-time Socket.IO stream for computed analysis.
- AI pathfinder strategies: **lowest risk**, **fastest**, **least hops**, **best (hybrid)**.
- Flask endpoints to start/stop analysis and compute paths.

---

## 🧱 Architecture (high level)
```
Node.js simulator  --->  JSON/CSV files  --->  Python trainers (XGBoost / SKLearn)
       |                       |                     |
       |                       v                     v
       |               graph_live.json     trained models (*.joblib)
       |                       |                     |
       +----> Flask (app.py) <----------------------/
                 |   \__ launches predictors & generator
                 | 
                 +--> D3.js dashboard (templates/index.html)
                 |
            SocketIO (src/aiAnalysis.py on :5050)
```

**Ports**
- Flask app (`app.py`): **http://127.0.0.1:5000/**
- AI Analysis SocketIO (`src/aiAnalysis.py`): **http://127.0.0.1:5050/**

---

## 🧰 Tech Stack
**Backend:** Python (Flask, Flask-SocketIO, NetworkX), scikit-learn, XGBoost, pandas, numpy  
**Frontend:** HTML/CSS/JS, D3.js  
**Generator:** Node.js (json2csv), CSV exports for training  
**Data:** JSON under `static/graph-data/` (e.g., `graph.json`, `graph_live.json`, predicted files)

---

## 📦 Requirements
- **Python** 3.9+
- **Node.js** 16+ (for the simulator & json2csv)
- pip & virtualenv recommended

Python packages (from `requirements.txt`):
```
blinker==1.9.0
click==8.2.1
colorama==0.4.6
Flask==3.1.1
flask-cors==6.0.1
itsdangerous==2.2.0
Jinja2==3.1.6
joblib==1.5.1
MarkupSafe==3.0.2
networkx==3.5
numpy==2.3.1
pandas==2.3.0
python-dateutil==2.9.0.post0
pytz==2025.2
scikit-learn==1.7.0
scipy==1.16.0
six==1.17.0
threadpoolctl==3.6.0
tzdata==2025.2
Werkzeug==3.1.3
xgboost==3.0.2
```

Latency training snippet uses:
```python
import pandas as pd
import glob
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib
```

---

## 🚀 Setup & Run (Local)

### 1️⃣ Clone & Python setup
```bash
git clone https://github.com/<your-username>/NetRouteAI.git
cd NetRouteAI

python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2️⃣ Install Node.js (if not already installed)
Download from https://nodejs.org/ and install.

Check version:
```bash
node -v
```

> If your repo has a `package.json`, run `npm install`.  
> If not, install the needed package explicitly: `npm i json2csv`.

### 3️⃣ Start the backend & frontend
```bash
python app.py
```
This:
- **Starts Flask backend** on **http://127.0.0.1:5000/**
- **Launches mock data generator** (`src/patterned_mock_graph_generator.js`)
- **Runs ML predictors** (`src/predict_latency.py` & `src/predict_alarm_status.py`)

### 4️⃣ Start AI Analysis dashboard
In a **new terminal** (with your virtualenv active):
```bash
python src/aiAnalysis.py
```
This starts the **SocketIO server on port 5050** for real-time AI analysis updates.

### 5️⃣ Open the UI
- Main dashboard: `http://127.0.0.1:5000`
- SocketIO service: `http://127.0.0.1:5050` (programmatic)

---

## 🔁 Key Runtime Files
- **Source (base) topology**: `static/graph-data/graph.json` (editable)
- **Live graph (real)**: `static/graph-data/graph_live.json` (written by simulator)
- **Predicted latency**: `static/graph-data/graph_live_predicted.json` (written by predictor)
- **Predicted alarms**: `static/graph-data/graph_live_alarm_predicted.json` (written by classifier)
- **CSV exports**: `csv-data/*.csv` (rotated & used by training scripts)

---

## 📡 Core Endpoints (Flask in `app.py`)
- `POST /ai-analysis/start` → spawn `src/aiAnalysis.py`
- `POST /ai-analysis/stop` → terminate running analysis process
- `POST /predict-path`  
  Request JSON:
  ```json
  { "source": "nodeA", "target": "nodeB", "strategy": "best" }
  ```
  Where `strategy` ∈ `["lowest_risk", "fastest", "least_hops", "best"]` (default: `"best"`).

---

## 🧪 Tips
- Ensure `static/graph-data/` exists and contains a valid `graph.json` export.
- If files are mid-write, the analysis server uses **safe JSON loading** with stability checks/retries.
- If you change ports, update your frontend fetch/socket targets accordingly.

---

## 📁 Project Structure (simplified)
```
NetRouteAI/
├─ app.py
├─ src/
│  ├─ aiAnalysis.py                # SocketIO server (port 5050)
│  ├─ patterned_mock_graph_generator.js
│  ├─ generate_startup_data.py      # One file that invokes mock js file and prediction backend
│  ├─ predict_latency.py
│  ├─ predict_alarm_status.py
│  ├─ train_model.py
│  ├─ train_alarm_classifier.py
├─ templates/
│  └─ index.html
├─ static/
│  ├─ js files			# front-end js 
│  ├─ images 			# Icons
│  └─ graph-data/
│     ├─ graph.json
│     ├─ graph_live.json
│     ├─ graph_live_predicted.json
│     └─ graph_live_alarm_predicted.json
├─ csv-data/                       # created at runtime
├─ requirements.txt
└─ README.md
```

---

## 📄 License
This  project  is licensed under the **MIT** License.

---

## 👤 Credits
Created by **Mohit Gautam**.

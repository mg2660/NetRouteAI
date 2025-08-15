export async function renderPathForm(containerId) {
  const container = document.getElementById(containerId);

  let autoRefresh = false;
  let intervalId = null;

  // Inject scrollbar CSS styles dynamically
  const style = document.createElement('style');
  style.textContent = `
    #pathResult {
      max-height: 300px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #4ade80 #1f2937;
    }
    #pathResult::-webkit-scrollbar {
      width: 8px;
    }
    #pathResult::-webkit-scrollbar-track {
      background: #1f2937;
      border-radius: 4px;
    }
    #pathResult::-webkit-scrollbar-thumb {
      background-color: #4ade80;
      border-radius: 4px;
      border: 2px solid #1f2937;
    }
    #pathResult::-webkit-scrollbar-thumb:hover {
      background-color: #22c55e;
    }
  `;
  document.head.appendChild(style);

  // HTML content first
  container.innerHTML = `
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-lg font-semibold text-green-300">Path Finder</h2>
      <div class="flex gap-4 items-center">
        <label class="text-sm text-gray-400 flex items-center gap-1">
          <input type="checkbox" id="autoRefreshToggle" class="form-checkbox text-green-500">
          Auto-Refresh
        </label>
        <button id="manualRefreshBtn" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm">
          🔄 Refresh Nodes
        </button>
      </div>
    </div>
    <p id="lastUpdated" class="text-xs text-gray-400 mb-3">Last updated: --</p>

    <form id="pathForm" class="space-y-4 max-w-xl mx-auto p-4">
      <div>
        <label class="block text-sm text-gray-300">Source Node</label>
        <select name="source" id="sourceSelect" class="w-full p-2 rounded bg-gray-800 text-green-400 border border-green-500 max-h-40 overflow-y-auto" required>
          <option disabled selected value="">-- Loading --</option>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-300">Destination Node</label>
        <select name="destination" id="destinationSelect" class="w-full p-2 rounded bg-gray-800 text-green-400 border border-green-500 max-h-40 overflow-y-auto" required>
          <option disabled selected value="">-- Loading --</option>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-300">Strategy</label>
        <select name="strategy" id="strategySelect" class="w-full p-2 rounded bg-gray-800 text-green-400 border border-green-500">
          <option value="latency">Best Latency</option>
          <option value="hops">Least Hops</option>
          <option value="risk">Lowest Risk</option>
          <option value="best">Best (Hybrid)</option>
        </select>
      </div>

      <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">
        Find Path
      </button>
    </form>

    <div id="pathResult" class="mt-6 bg-black p-4 rounded text-green-400 font-mono text-sm"></div>
  `;

  // ... rest of your existing functions and event handlers remain unchanged
  // (triggerPathRequest, fetchAndRenderNodes, event listeners, etc.)

  // ✅ Trigger path prediction logic
  async function triggerPathRequest(source, destination, strategy) {
    const resultDiv = document.getElementById("pathResult");
    resultDiv.innerHTML = `<span class='text-yellow-400'>⏳ Calculating path...</span>`;

    try {
      const res = await fetch("/predict-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target: destination, strategy }),
      });

      const data = await res.json();

      if (data.error) {
        resultDiv.innerHTML = `<span class='text-red-500'>🚫 ${data.error}</span>`;
        return;
      }

      const pathHtml = data.paths
        .map(
          (p, idx) => `
        <div class="mb-4 border-t border-green-600 pt-2">
          <p><strong>Path ${idx + 1}:</strong> ${p.path.join(" → ")}</p>
          <p>Latency: ${p.latency}ms</p>
          ${
            p.health_penalty !== undefined
              ? `<p>Health Penalty: ${p.health_penalty}</p>`
              : ""
          }
          ${
            p.risk_score !== undefined ? `<p>Risk Score: ${p.risk_score}</p>` : ""
          }
        </div>
      `
        )
        .join("");

      resultDiv.innerHTML = `
        <p class='text-green-400 font-bold mb-3'>✅ ${data.message}</p>
        ${
          data.cutoff_used
            ? `<p class='text-gray-400 mb-4'>Cutoff Used: ${data.cutoff_used}</p>`
            : ""
        }
        ${pathHtml}
      `;
    } catch (err) {
      resultDiv.innerHTML = `<span class='text-red-500'>🔥 Error: ${err.message}</span>`;
    }
  }

  // ✅ Refresh node dropdowns and update timestamp
  async function fetchAndRenderNodes() {
    try {
      const res = await fetch("/static/graph-data/graph_live_alarm_predicted.json");
      const alarmData = await res.json();

      const healthyNodes = alarmData.nodes.filter(
        (node) => node.properties?.predicted_alarm_status !== "RED"
      );

      const sourceSelect = document.getElementById("sourceSelect");
      const destSelect = document.getElementById("destinationSelect");

      const previousSource = sourceSelect?.value;
      const previousDest = destSelect?.value;

      const optionsHtml = healthyNodes
        .map((node) => `<option value="${node.id}">${node.id}</option>`)
        .join("");

      if (sourceSelect && destSelect) {
        sourceSelect.innerHTML = `
          <option disabled ${!previousSource ? "selected" : ""} value="">
            -- Select Source Node --
          </option>
          ${optionsHtml}
        `;
        destSelect.innerHTML = `
          <option disabled ${!previousDest ? "selected" : ""} value="">
            -- Select Destination Node --
          </option>
          ${optionsHtml}
        `;

        if (healthyNodes.some((n) => n.id === previousSource)) {
          sourceSelect.value = previousSource;
        }
        if (healthyNodes.some((n) => n.id === previousDest)) {
          destSelect.value = previousDest;
        }
      }

      const now = new Date().toLocaleTimeString();
      const updatedEl = document.getElementById("lastUpdated");
      if (updatedEl) updatedEl.textContent = `Last updated: ${now}`;

      // 🔁 Re-calculate path if both source and destination are selected
      if (
        sourceSelect?.value &&
        destSelect?.value &&
        sourceSelect.value !== "" &&
        destSelect.value !== ""
      ) {
        const strategy = document.getElementById("strategySelect").value;
        triggerPathRequest(sourceSelect.value, destSelect.value, strategy);
      }
    } catch (error) {
      console.error("❌ Failed to fetch node data:", error);
    }
  }

  // ✅ Manual Refresh
  document
    .getElementById("manualRefreshBtn")
    .addEventListener("click", fetchAndRenderNodes);

  // ✅ Auto Refresh Toggle
  document
    .getElementById("autoRefreshToggle")
    .addEventListener("change", function () {
      autoRefresh = this.checked;
      if (autoRefresh) {
        fetchAndRenderNodes(); // initial
        intervalId = setInterval(fetchAndRenderNodes, 5000);
      } else {
        clearInterval(intervalId);
      }
    });

  // ✅ Handle Form Submit
  document.getElementById("pathForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const formData = new FormData(this);
    const source = formData.get("source");
    const destination = formData.get("destination");
    const strategy = formData.get("strategy");

    triggerPathRequest(source, destination, strategy);
  });

  // 🟢 Initial fetch
  fetchAndRenderNodes();
}

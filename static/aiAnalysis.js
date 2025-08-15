let aiSocket = null; // Keep reference for disconnect
let aiObserver = null; // MutationObserver for auto-disconnect

export function renderAIAnalysis(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`❌ renderAIAnalysis: Container #${containerId} not found`);
    return;
  }

  // Inject HTML
  container.innerHTML = `
    <div class="p-4 h-full overflow-y-auto">
      <h2 class="text-xl text-green-400 mb-4">AI Analysis Dashboard</h2>
      <div class="border-b border-gray-700 mb-4">
        <nav class="-mb-px flex space-x-4">
          <button id="tab-alarm" class="tab-btn text-yellow-400 border-b-2 border-yellow-400 px-3 py-2 text-sm font-medium">Alarm Status</button>
          <button id="tab-latency" class="tab-btn text-gray-400 hover:text-blue-400 hover:border-blue-400 border-b-2 border-transparent px-3 py-2 text-sm font-medium">Link Latency</button>
        </nav>
      </div>
      <div id="tab-alarm-content">
        <p class="text-sm text-gray-400 mb-2">Comparison of real-time and predicted alarm status for each node.</p>
        <div id="alarmTableContainer" class="overflow-x-auto rounded shadow border border-gray-700"></div>
      </div>
      <div id="tab-latency-content" class="hidden">
        <p class="text-sm text-gray-400 mb-2">Comparison of real-time and predicted latency between node links.</p>
        <div id="latencyTableContainer" class="overflow-x-auto rounded shadow border border-gray-700"></div>
      </div>
    </div>
  `;

  // Tab switching
  const tabAlarm = container.querySelector('#tab-alarm');
  const tabLatency = container.querySelector('#tab-latency');
  const contentAlarm = container.querySelector('#tab-alarm-content');
  const contentLatency = container.querySelector('#tab-latency-content');

  tabAlarm.addEventListener('click', () => {
    tabAlarm.classList.add('text-yellow-400', 'border-yellow-400');
    tabAlarm.classList.remove('text-gray-400');
    tabLatency.classList.add('text-gray-400');
    tabLatency.classList.remove('text-blue-400', 'border-blue-400');
    contentAlarm.classList.remove('hidden');
    contentLatency.classList.add('hidden');
  });

  tabLatency.addEventListener('click', () => {
    tabLatency.classList.add('text-blue-400', 'border-blue-400');
    tabLatency.classList.remove('text-gray-400');
    tabAlarm.classList.add('text-gray-400');
    tabAlarm.classList.remove('text-yellow-400', 'border-yellow-400');
    contentAlarm.classList.add('hidden');
    contentLatency.classList.remove('hidden');
  });

  // Start fetching
  fetchDataAndRender();

  // Socket.IO connection
  aiSocket = io("http://localhost:5050");
  aiSocket.on('connect', () => console.log("✅ Connected to backend via Socket.IO"));
  aiSocket.on('dataUpdate', () => {
    console.log("⚡ Real-time data update received");
    fetchDataAndRender();
  });

  // Auto-disconnect if container is removed
  aiObserver = new MutationObserver(() => {
    if (!document.getElementById(containerId)) {
      console.warn(`🛑 Container #${containerId} removed — disconnecting socket`);
      disconnectAIAnalysis();
    }
  });
  aiObserver.observe(document.body, { childList: true, subtree: true });
}

export function disconnectAIAnalysis() {
  if (aiSocket) {
    aiSocket.disconnect();
    aiSocket = null;
    console.log("🔌 AI Analysis socket disconnected");
  }
  if (aiObserver) {
    aiObserver.disconnect();
    aiObserver = null;
    console.log("👀 MutationObserver stopped");
  }
}

async function fetchDataAndRender() {
  try {
    const [realRes, alarmPredRes, latencyPredRes] = await Promise.all([
      fetch('/static/graph-data/graph_live.json'),
      fetch('/static/graph-data/graph_live_alarm_predicted.json'),
      fetch('/static/graph-data/graph_live_predicted.json')
    ]);

    const [realData, alarmPredData, latencyPredData] = await Promise.all([
      realRes.json(),
      alarmPredRes.json(),
      latencyPredRes.json()
    ]);

    const alarmContainer = document.getElementById('alarmTableContainer');
    const latencyContainer = document.getElementById('latencyTableContainer');
    if (!alarmContainer || !latencyContainer) {
      console.warn("⚠️ Skipping render — containers not found");
      return;
    }

    // Alarms
    const realNodeMap = Object.fromEntries(realData.nodes.map(n => [n.id, n.properties]));
    const predictedAlarmMap = Object.fromEntries(alarmPredData.nodes.map(n => [n.id, n.properties.predicted_alarm_status]));
    const alarmRows = Object.entries(realNodeMap).map(([id, props]) => ({
      node: id,
      real_alarm: props.alarm_status || 'UNKNOWN',
      predicted_alarm: predictedAlarmMap[id] || 'UNKNOWN',
      mismatch: (props.alarm_status || 'UNKNOWN') !== (predictedAlarmMap[id] || 'UNKNOWN')
    }));

    // Latencies
    const predictedLatencyMap = {};
    latencyPredData.links.forEach(link => {
      predictedLatencyMap[`${link.source}__${link.target}`] = link.properties.predicted_latency_ms;
    });
    const latencyRows = realData.links
      .filter(link => predictedLatencyMap[`${link.source}__${link.target}`] !== undefined)
      .map(link => {
        const key = `${link.source}__${link.target}`;
        return {
          link: `${link.source} → ${link.target}`,
          real_latency: link.properties.latency_ms,
          predicted_latency: predictedLatencyMap[key],
          mismatch: Math.abs(link.properties.latency_ms - predictedLatencyMap[key]) > 10
        };
      });

    renderAlarmTable(alarmRows);
    renderLatencyTable(latencyRows);

  } catch (err) {
    console.error('Error loading AI data:', err);
    const alarmContainer = document.getElementById('alarmTableContainer');
    const latencyContainer = document.getElementById('latencyTableContainer');
    if (alarmContainer) alarmContainer.innerHTML = '<p class="text-red-400">Error loading data.</p>';
    if (latencyContainer) latencyContainer.innerHTML = '<p class="text-red-400">Error loading data.</p>';
  }
}

function renderAlarmTable(data) {
  const alarmContainer = document.getElementById('alarmTableContainer');
  if (!alarmContainer) return;

  const getColorClass = (value) => {
    if (value.includes('RED')) return 'text-red-400';
    if (value.includes('YELLOW')) return 'text-yellow-400';
    if (value.includes('GREEN')) return 'text-green-400';
    return 'text-white';
  };
  const getBadge = (mismatch) =>
    mismatch
      ? '<span class="px-2 py-1 text-xs bg-red-500 text-white rounded-full">Mismatch</span>'
      : '<span class="px-2 py-1 text-xs bg-green-600 text-white rounded-full">Matched</span>';

  alarmContainer.innerHTML = `
    <table class="min-w-full text-sm text-left">
      <thead class="bg-gray-800 text-gray-300">
        <tr>
          <th class="py-2 px-4">Node</th>
          <th class="py-2 px-4">Real Alarm</th>
          <th class="py-2 px-4">Predicted Alarm</th>
          <th class="py-2 px-4">Mismatch</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(row => `
          <tr>
            <td class="py-2 px-4 border-b border-gray-700">${row.node}</td>
            <td class="py-2 px-4 border-b border-gray-700 ${getColorClass(row.real_alarm)}">${row.real_alarm}</td>
            <td class="py-2 px-4 border-b border-gray-700 ${getColorClass(row.predicted_alarm)}">${row.predicted_alarm}</td>
            <td class="py-2 px-4 border-b border-gray-700">${getBadge(row.mismatch)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderLatencyTable(data) {
  const latencyContainer = document.getElementById('latencyTableContainer');
  if (!latencyContainer) return;

  const getBadge = (mismatch) =>
    mismatch
      ? '<span class="px-2 py-1 text-xs bg-red-500 text-white rounded-full">Mismatch</span>'
      : '<span class="px-2 py-1 text-xs bg-green-600 text-white rounded-full">Matched</span>';

  latencyContainer.innerHTML = `
    <table class="min-w-full text-sm text-left">
      <thead class="bg-gray-800 text-gray-300">
        <tr>
          <th class="py-2 px-4">Link</th>
          <th class="py-2 px-4">Real Latency</th>
          <th class="py-2 px-4">Predicted Latency</th>
          <th class="py-2 px-4">Mismatch</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(row => `
          <tr>
            <td class="py-2 px-4 border-b border-gray-700">${row.link}</td>
            <td class="py-2 px-4 border-b border-gray-700">${row.real_latency.toFixed(1)} ms</td>
            <td class="py-2 px-4 border-b border-gray-700">${row.predicted_latency.toFixed(1)} ms</td>
            <td class="py-2 px-4 border-b border-gray-700">${getBadge(row.mismatch)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

let aiSocket = null; // Keep reference for disconnect

export function renderAIAnalysis(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`❌ renderAIAnalysis: Container #${containerId} not found`);
    return;
  }

  // 1️⃣ Inject HTML first
  container.innerHTML = `
    <div class="p-4 h-full overflow-y-auto">
      <h2 class="text-xl text-green-400 mb-4">AI Analysis Dashboard</h2>

      <!-- Tabs -->
      <div class="border-b border-gray-700 mb-4">
        <nav class="-mb-px flex space-x-4">
          <button id="tab-alarm" class="tab-btn text-yellow-400 border-b-2 border-yellow-400 px-3 py-2 text-sm font-medium">Alarm Status</button>
          <button id="tab-latency" class="tab-btn text-gray-400 hover:text-blue-400 hover:border-blue-400 border-b-2 border-transparent px-3 py-2 text-sm font-medium">Link Latency</button>
        </nav>
      </div>

      <!-- Tab Contents -->
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

  // 2️⃣ Now safely bind elements
  const tabAlarm = container.querySelector('#tab-alarm');
  const tabLatency = container.querySelector('#tab-latency');
  const contentAlarm = container.querySelector('#tab-alarm-content');
  const contentLatency = container.querySelector('#tab-latency-content');

  if (!tabAlarm || !tabLatency) {
    console.error('❌ renderAIAnalysis: Tab elements not found');
    return;
  }

  // Tab click handling
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

  // 3️⃣ Fetch + render data
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

      // Map for alarms
      const realNodeMap = Object.fromEntries(realData.nodes.map(n => [n.id, n.properties]));
      const predictedAlarmMap = Object.fromEntries(alarmPredData.nodes.map(n => [n.id, n.properties.predicted_alarm_status]));

      const alarmRows = Object.entries(realNodeMap).map(([id, props]) => {
        const realAlarm = props.alarm_status || 'UNKNOWN';
        const predAlarm = predictedAlarmMap[id] || 'UNKNOWN';
        return {
          node: id,
          real_alarm: realAlarm,
          predicted_alarm: predAlarm,
          mismatch: realAlarm !== predAlarm
        };
      });

      // Map for latencies
      const predictedLatencyMap = {};
      latencyPredData.links.forEach(link => {
        predictedLatencyMap[`${link.source}__${link.target}`] = link.properties.predicted_latency_ms;
      });

      const latencyRows = realData.links
        .filter(link => predictedLatencyMap[`${link.source}__${link.target}`] !== undefined)
        .map(link => {
          const key = `${link.source}__${link.target}`;
          const realLatency = link.properties.latency_ms;
          const predictedLatency = predictedLatencyMap[key];
          return {
            link: `${link.source} → ${link.target}`,
            real_latency: realLatency,
            predicted_latency: predictedLatency,
            mismatch: Math.abs(realLatency - predictedLatency) > 10
          };
        });

      renderAlarmTable(alarmRows);
      renderLatencyTable(latencyRows);

    } catch (err) {
      console.error('Error loading AI data:', err);
      document.getElementById('alarmTableContainer').innerHTML = '<p class="text-red-400">Error loading data.</p>';
      document.getElementById('latencyTableContainer').innerHTML = '<p class="text-red-400">Error loading data.</p>';
    }
  }

  function renderAlarmTable(data) {
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

    document.getElementById('alarmTableContainer').innerHTML = `
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
    const getBadge = (mismatch) =>
      mismatch
        ? '<span class="px-2 py-1 text-xs bg-red-500 text-white rounded-full">Mismatch</span>'
        : '<span class="px-2 py-1 text-xs bg-green-600 text-white rounded-full">Matched</span>';

    document.getElementById('latencyTableContainer').innerHTML = `
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

  // Initial fetch
  fetchDataAndRender();

  // 4️⃣ Socket.IO connection
  aiSocket = io("http://localhost:5050");
  aiSocket.on('connect', () => console.log("✅ Connected to backend via Socket.IO"));
  aiSocket.on('dataUpdate', () => {
    console.log("⚡ Real-time data update received");
    fetchDataAndRender();
  });
}

export function disconnectAIAnalysis() {
  if (aiSocket) {
    aiSocket.disconnect();
    aiSocket = null;
    console.log("🔌 AI Analysis socket disconnected");
  }
}

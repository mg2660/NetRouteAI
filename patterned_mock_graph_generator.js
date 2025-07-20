const fs = require('fs');
const path = require('path');
const { parse } = require('json2csv');
const { spawn } = require('child_process');

let graph = require('./graph-data/graph.json');

const csvDir = path.join(__dirname, 'csv-data');
if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir);

const INTERVAL_MS = 2500;
let recordCount = 0;
let fileIndex = 1;

let nodeCsvPath = getCsvPath('node');
let linkCsvPath = getCsvPath('link');

// === Helper Functions ===

function getCsvPath(type) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(csvDir, `${type}_data_${fileIndex}_${timestamp}.csv`);
}

function rotateFilesAndTrain() {
  fileIndex++;
  nodeCsvPath = getCsvPath('node');
  linkCsvPath = getCsvPath('link');
  recordCount = 0;

  console.log(`\n📦 Rotated CSV files at ${new Date().toLocaleTimeString()}`);
  console.log('🚀 Starting model training...\n');

  const pythonProcess = spawn('python', ['ml/train_model.py']);

  pythonProcess.stdout.on('data', data => process.stdout.write(`🧠 ${data}`));
  pythonProcess.stderr.on('data', data => process.stderr.write(`❗ ${data}`));
  pythonProcess.on('close', code => {
    console.log(`✅ Model training completed with code ${code}\n`);
  });
}

function appendCsv(filePath, data, fields) {
  const csv = parse(data, { fields, header: !fs.existsSync(filePath) });
  fs.appendFileSync(filePath, csv + '\n');
}

// === Graph Functions ===

const nodeStates = new Map();

function randomFloat(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function smoothStep(prev, delta, min = 0, max = 100) {
  let val = prev + (Math.random() * delta - delta / 2);
  return Math.min(max, Math.max(min, val));
}

function getBaseLatencyForNode(node) {
  const label = node.labels?.[0];
  switch (label) {
    case "gNB": return randomFloat(5, 15);
    case "FIREWALL": return randomFloat(2, 10);
    case "EDGE_DC": return randomFloat(5, 20);
    case "CORE_DC": return randomFloat(10, 50);
    case "UPF":
    case "SMF":
    case "AMF":
    case "MONITOR": return randomFloat(5, 20);
    default: return randomFloat(10, 30);
  }
}

graph.nodes.forEach(node => {
  nodeStates.set(node.id, {
    cpu: randomFloat(20, 70),
    mem: randomFloat(20, 70),
    latency: randomFloat(1, 6),
    trend: randomFloat(-0.5, 0.5)
  });
});

// Place this outside the function so it persists across cycles
const alarmHistory = new Map(); // Keeps last 3 readings for smoothing

function updateAlarmStatus(node, cpu, latency, role) {
  const key = node.id;
  const hist = alarmHistory.get(key) || [];
  hist.push({ cpu, latency });
  if (hist.length > 3) hist.shift(); // Keep last 3 records
  alarmHistory.set(key, hist);

  // Role sensitivity (weighting factor)
  const roleSensitivity = {
    "gNB": 1.0,
    "CORE_DC": 1.2,
    "EDGE_DC": 1.1,
    "FIREWALL": 1.3,
    "MONITOR": 0.9
  };

  const factor = roleSensitivity[role] || 1.0;

  // Calculate smoothed averages
  const avgCpu = hist.reduce((sum, h) => sum + h.cpu, 0) / hist.length;
  const avgLatency = hist.reduce((sum, h) => sum + h.latency, 0) / hist.length;

  const adjustedCpu = avgCpu * factor;
  const adjustedLatency = avgLatency * factor;

  // Core logic
  let alarm = "GREEN";
  if (adjustedCpu > 90 || adjustedLatency > 50) alarm = "RED";
  else if (adjustedCpu > 70 || adjustedLatency > 25) alarm = "YELLOW";

  // Add 5% random fluctuation
  const roll = Math.random();
  if (roll < 0.05) {
    if (alarm === "RED") alarm = "YELLOW";
    else if (alarm === "YELLOW") alarm = randomChoice(["GREEN", "RED"]);
    else if (alarm === "GREEN") alarm = "YELLOW";
  }

  return alarm;
}


function updateGraphData(original) {
  const updated = JSON.parse(JSON.stringify(original));
  const timeFactor = Math.sin((Date.now() / 1000 / 60) * (2 * Math.PI));

  updated.nodes.forEach(node => {
    const state = nodeStates.get(node.id);
    if (!state || !node.properties) return;

    state.cpu += state.trend + timeFactor * 2;
    state.mem = smoothStep(state.mem, 2, 0, 100);
    state.cpu = Math.max(0, Math.min(100, state.cpu));

    let baseLatency = getBaseLatencyForNode(node);
    if (Math.random() < 0.05) baseLatency += randomFloat(20, 50);
    state.latency = baseLatency;

    node.properties.cpu_usage = parseFloat(state.cpu.toFixed(2));
    node.properties.memory_usage = parseFloat(state.mem.toFixed(2));
    node.properties.latency_avg = parseFloat(state.latency.toFixed(2));
    node.properties.packet_loss_rate = parseFloat((state.latency / 20 + Math.random()).toFixed(2));

    const role = node.labels?.[0] || "UNKNOWN";
    const alarm = updateAlarmStatus(node, state.cpu, state.latency, role);
    node.properties.alarm_status = alarm;
    node.properties.is_overloaded = state.cpu > 90 || state.mem > 90 || node.properties.packet_loss_rate > 5;
  });

  updated.links.forEach(link => {
    if (!link.properties) return;

    const srcNode = updated.nodes.find(n => n.id === link.source)?.properties;
    const tgtNode = updated.nodes.find(n => n.id === link.target)?.properties;

    const base = ((srcNode?.latency_avg || 10) + (tgtNode?.latency_avg || 10)) / 2;
    const noise = randomFloat(-5, 5);
    link.properties.latency_ms = Math.max(5, Math.floor(base + noise));

    link.properties.bandwidth_mbps = randomChoice([50, 100, 200, 500, 1000]);
  });


  return updated;
}

// === Main Loop ===

setInterval(() => {
  const updatedGraph = updateGraphData(graph);
  const timestamp = new Date().toISOString();

  const livePath = path.join(__dirname, 'graph-data', 'graph_live.json');
  fs.writeFileSync(livePath, JSON.stringify(updatedGraph, null, 2));


  const nodeRows = updatedGraph.nodes.map(n => ({
    timestamp,
    id: n.id,
    type: n.labels?.[0] || "",
    alarm_status: n.properties?.alarm_status,
    cpu_usage: n.properties?.cpu_usage,
    memory_usage: n.properties?.memory_usage,
    latency_avg: n.properties?.latency_avg,
    packet_loss_rate: n.properties?.packet_loss_rate,
    is_overloaded: n.properties?.is_overloaded
  }));

  const alarmMap = { GREEN: 0, YELLOW: 1, RED: 2 };

  const linkRows = updatedGraph.links.map(link => {
    const srcNode = updatedGraph.nodes.find(n => n.id === link.source);
    const tgtNode = updatedGraph.nodes.find(n => n.id === link.target);
    const src = srcNode?.properties;
    const tgt = tgtNode?.properties;

    return {
      timestamp,
      source: link.source,
      target: link.target,
      latency_ms: link.properties?.latency_ms,
      bandwidth_mbps: link.properties?.bandwidth_mbps,
      cpu_source: src?.cpu_usage,
      cpu_target: tgt?.cpu_usage,
      mem_source: src?.memory_usage,
      mem_target: tgt?.memory_usage,
      packet_loss_rate: (src?.packet_loss_rate + tgt?.packet_loss_rate) / 2,
      alarm_status_source: alarmMap[src?.alarm_status] ?? -1,
      alarm_status_target: alarmMap[tgt?.alarm_status] ?? -1,
      latency_avg_source: src?.latency_avg,
      latency_avg_target: tgt?.latency_avg
    };
  });

  appendCsv(nodeCsvPath, nodeRows, Object.keys(nodeRows[0]));
  appendCsv(linkCsvPath, linkRows, Object.keys(linkRows[0]));

  recordCount += linkRows.length;
  console.log(`📊 Updated ${recordCount} records @ ${new Date().toLocaleTimeString()}`);

  if (recordCount >= 10000) rotateFilesAndTrain();

}, INTERVAL_MS);

// === Stop script after 10 minutes ===
const STOP_AFTER_MS = 10 * 60 * 1000;
setTimeout(() => {
  console.log(`\n🛑 Script stopped after ${STOP_AFTER_MS / 60000} minutes.`);
  process.exit(0);
}, STOP_AFTER_MS);

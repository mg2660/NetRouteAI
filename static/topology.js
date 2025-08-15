// topology.js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let refreshIntervalId = null;
let isPaused = false;
let previousRedEntities = new Set();

export function renderTopology(containerId, dataUrl) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div id="loader" class="fixed inset-0 flex items-center justify-center bg-black z-50">
      <div class="spinner border-4 border-green-500 border-t-transparent rounded-full w-12 h-12 animate-spin"></div>
      <div class="loader-text text-green-400 ml-4">Loading graph...</div>
    </div>
    <div class="flex justify-between items-center py-2 px-4 text-green-400 text-sm">
      <div id="lastUpdated"></div>
      <div class="flex items-center space-x-4">
        <button id="toggleRefresh" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded">⏸️ Pause Auto-Refresh</button>
        <div id="alertIndicator" class="hidden text-red-500 font-bold">⚠️ New RED detected!</div>
      </div>
    </div>
    <svg id="graph" style="width: 100%; height: 90vh;"></svg>
    <div id="tooltip" class="tooltip" style="display: none;"></div>
  `;

  const tooltip = d3.select("#tooltip")
    .style("position", "absolute")
    .style("background", "#111")
    .style("border", "1px solid #0f0")
    .style("padding", "6px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("color", "#0f0");

  const alertIndicator = document.getElementById("alertIndicator");
  const lastUpdated = document.getElementById("lastUpdated");
  const toggleRefreshBtn = document.getElementById("toggleRefresh");

  toggleRefreshBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    toggleRefreshBtn.textContent = isPaused ? "▶️ Resume Auto-Refresh" : "⏸️ Pause Auto-Refresh";
  });

  let nodeMap = new Map();

  function getNodeColor(node) {
    const status = node.properties?.predicted_alarm_status || node.properties?.alarm_status || "GREEN";
    if (status === "RED") return "#ff0000";
    if (status === "YELLOW") return "#ffbf00";
    return "#0f0";
  }

  function updateGraphProperties(newData) {
    let currentRed = new Set();

    newData.nodes.forEach(n => {
      const existing = nodeMap.get(n.id);
      if (existing) existing.properties = n.properties;
      if (n.properties?.alarm_status === "RED" || n.properties?.predicted_alarm_status === "RED") {
        currentRed.add(n.id);
      }
    });

    d3.selectAll("line").each(function(d) {
      const sourceId = typeof d.source === "object" ? d.source.id : d.source;
      const targetId = typeof d.target === "object" ? d.target.id : d.target;
      const updatedLink = newData.links.find(
        l => (l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId)
      );
      if (updatedLink) {
        d.properties = updatedLink.properties;
        if (updatedLink.properties?.alarm_status === "RED") {
          currentRed.add(`${sourceId}-${targetId}`);
        }
      }
    });

    const hasNewRed = Array.from(currentRed).some(id => !previousRedEntities.has(id));
    alertIndicator.classList.toggle("hidden", !hasNewRed);
    previousRedEntities = currentRed;

    d3.selectAll("circle").transition().duration(300).attr("fill", getNodeColor);
    d3.selectAll("line").transition().duration(300).style("stroke", d => {
      const s = d.source?.properties?.alarm_status;
      const t = d.target?.properties?.alarm_status;
      if (s === "RED" || t === "RED") return "#ff0000";
      if (s === "YELLOW" || t === "YELLOW") return "#ffbf00";
      return "#0f0";
    });

    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = setInterval(() => {
    if (isPaused) return;
    const ts = Date.now();
    d3.json(`${dataUrl}?t=${ts}`).then(newData => {
      if (!newData?.nodes?.length) return;
      updateGraphProperties(newData);
    });
  }, 5000);

  d3.json(dataUrl).then(data => {
    document.getElementById("loader").classList.add("hidden");

    const nodes = data.nodes;
    const links = data.links;
    const svg = d3.select("#graph");
    const width = container.clientWidth;
    const height = 800;
    const graph = svg.append("g");

    const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", event => graph.attr("transform", event.transform));
    svg.call(zoom);

    const link = graph.append("g").attr("class", "links")
      .selectAll("line").data(links).enter().append("line")
      .attr("stroke-width", 2)
      .style("stroke", d => {
        const statusA = d.source.properties?.alarm_status;
        const statusB = d.target.properties?.alarm_status;
        if (statusA === "RED" || statusB === "RED") return "#ff0000";
        if (statusA === "YELLOW" || statusB === "YELLOW") return "#ffbf00";
        return "#0f0";
      })
      .on("mouseover", (event, d) => {
        const latency = d.properties?.latency_ms ? d.properties.latency_ms + "ms" : "N/A";
        const bandwidth = d.properties?.bandwidth_mbps || "N/A";
        const sourceId = d.source.id || d.source;
        const targetId = d.target.id || d.target;
        tooltip.style("display", "block")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px")
          .html(`<strong>Connection</strong><br>From: ${sourceId}<br>To: ${targetId}<br>Latency: ${latency}<br>Bandwidth: ${bandwidth}`);
      })
      .on("mouseout", () => tooltip.style("display", "none"));

    const node = graph.append("g").attr("class", "nodes")
      .selectAll("circle").data(nodes).enter().append("circle")
      .attr("r", 12)
      .attr("fill", getNodeColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .call(d3.drag()
        .on("start", event => { if (!event.active) simulation.alphaTarget(0.3).restart(); event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; })
        .on("drag", event => { event.subject.fx = event.x; event.subject.fy = event.y; })
        .on("end", event => { if (!event.active) simulation.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; })
      )
      .on("mouseover", (event, d) => {
        tooltip.style("display", "block")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px")
          .html(`<strong>${d.id}</strong><br>${Object.entries(d.properties).map(([k,v]) => `${k}: ${v}`).join("<br>")}`);
      })
      .on("mouseout", () => tooltip.style("display", "none"));

    const labels = graph.append("g").attr("class", "labels")
      .selectAll("text").data(nodes).enter().append("text")
      .attr("dy", -10)
      .attr("text-anchor", "middle")
      .text(d => d.id)
      .style("font-size", "14px")
      .style("font-weight", "bold")
      .style("fill", "#0f0");

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => d.x).attr("cy", d => d.y);
        labels.attr("x", d => d.x).attr("y", d => d.y);
      });

    nodeMap = new Map(nodes.map(n => [n.id, n]));
  });
}

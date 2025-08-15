// topology.js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let refreshIntervalId = null;
let isPaused = false;
let previousRedEntities = new Set();
  // Add these helpers near the top of renderTopology (above buildGraph)
const idStr = (v) => (v && typeof v === "object" && "id" in v ? String(v.id) : String(v));
const normKey = (a, b) => {
  const sa = idStr(a);
  const sb = idStr(b);
  return sa < sb ? `${sa}::${sb}` : `${sb}::${sa}`;
};

export function renderTopology(containerId, dataUrl) {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error(`Container #${containerId} not found`);
  }

  container.innerHTML = `
    <div id="loader" class="fixed inset-0 flex items-center justify-center bg-black/80 z-50">
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

  // UI elements
  const tooltip = d3
    .select("#tooltip")
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
    toggleRefreshBtn.textContent = isPaused
      ? "▶️ Resume Auto-Refresh"
      : "⏸️ Pause Auto-Refresh";
  });

  // State
  let nodeMap = new Map();
  let linkKeySet = new Set();
  let inFlight = false;

  // D3 selections and simulation
  const svg = d3.select("#graph");
  let graph = svg.append("g").attr("class", "main");
  let linkLayer = graph.append("g").attr("class", "links");
  let nodeLayer = graph.append("g").attr("class", "nodes");
  let labelLayer = graph.append("g").attr("class", "labels");

  let linkSel = linkLayer.selectAll("line");
  let nodeSel = nodeLayer.selectAll("circle");
  let labelSel = labelLayer.selectAll("text");

  // Zoom
  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 4])
    .on("zoom", (event) => graph.attr("transform", event.transform));
  svg.call(zoom);

  // Size helpers
  function getSize() {
    const rect = container.getBoundingClientRect();
    const width = rect.width || 800;
    const height =
      svg.node()?.getBoundingClientRect()?.height || rect.height || 600;
    return { width, height };
  }

  // Simulation
  const { width: initW, height: initH } = getSize();
  const simulation = d3
    .forceSimulation([])
    .force(
      "link",
      d3.forceLink([]).id((d) => d.id).distance(120)
    )
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(initW / 2, initH / 2))
    .on("tick", () => {
      linkSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      nodeSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      labelSel.attr("x", (d) => d.x).attr("y", (d) => d.y);
    });

  // Resize center
  function recenter() {
    const { width, height } = getSize();
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
  }
  window.addEventListener("resize", recenter, { passive: true });

  // Helpers
  const normKey = (a, b) => {
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? `${sa}::${sb}` : `${sb}::${sa}`;
  };

  function nodeStatus(props) {
    return props?.predicted_alarm_status || props?.alarm_status || "GREEN";
  }

  function getNodeColor(d) {
    const props = d?.properties || nodeMap.get(d?.id)?.properties;
    const status = nodeStatus(props);
    if (status === "RED") return "#ff0000";
    if (status === "YELLOW") return "#ffbf00";
    return "#0f0";
  }

  function getLinkColor(d) {
    const sp =
      (typeof d.source === "object"
        ? d.source.properties
        : nodeMap.get(d.source)?.properties) || {};
    const tp =
      (typeof d.target === "object"
        ? d.target.properties
        : nodeMap.get(d.target)?.properties) || {};
    const lp = d.properties || {};

    const ls = nodeStatus(lp);
    const ss = nodeStatus(sp);
    const ts = nodeStatus(tp);

    if (ls === "RED" || ss === "RED" || ts === "RED") return "#ff0000";
    if (ls === "YELLOW" || ss === "YELLOW" || ts === "YELLOW") return "#ffbf00";
    return "#0f0";
  }

  // Build or update the whole graph (handles topology changes)

function buildGraph(data) {
  const t = d3.zoomTransform(svg.node());

  // Update nodeMap with references (preserve positions if present)
  const incomingIds = new Set(data.nodes.map((n) => String(n.id)));
  for (const id of nodeMap.keys()) {
    if (!incomingIds.has(String(id))) nodeMap.delete(id);
  }

  data.nodes.forEach((n) => {
    const existing = nodeMap.get(n.id);
    if (existing) {
      existing.properties = { ...existing.properties, ...(n.properties || {}) };
    } else {
      nodeMap.set(n.id, { ...n, x: n.x, y: n.y });
    }
  });

  // Use node objects from nodeMap to keep identity stable
  const nodes = data.nodes.map((n) => nodeMap.get(n.id));

  // Resolve link endpoints to actual node objects; skip broken ones
  const links = [];
  for (const l of data.links || []) {
    const sId = idStr(l.source);
    const tId = idStr(l.target);
    const sNode = nodeMap.get(sId);
    const tNode = nodeMap.get(tId);

    if (!sNode || !tNode) {
      console.warn("Skipping link with missing endpoint:", { link: l, sNode, tNode });
      continue;
    }

    links.push({
      ...l,
      source: sNode,
      target: tNode,
      properties: { ...(l.properties || {}) },
      _key: normKey(sNode.id, tNode.id),
    });
  }

  if (links.length === 0) {
    console.warn("No valid links to render. Check source/target IDs in data.links.");
  }

  // JOIN — Links (bind resolved links so tick can read source/target.x/y)
  linkSel = linkLayer
    .selectAll("line")
    .data(links, (d) => d._key)
    .join(
      (enter) =>
        enter
          .append("line")
          .attr("stroke-width", 2)
          .style("stroke", (d) => getLinkColor(d))
          .on("mouseover", (event, d) => {
            const latency = d.properties?.latency_ms ? d.properties.latency_ms + "ms" : "N/A";
            const bandwidth = d.properties?.bandwidth_mbps || "N/A";
            tooltip
              .style("display", "block")
              .style("left", event.pageX + 10 + "px")
              .style("top", event.pageY + 10 + "px")
              .html(
                `<strong>Connection</strong><br>From: ${d.source.id}<br>To: ${d.target.id}<br>Latency: ${latency}<br>Bandwidth: ${bandwidth}`
              );
          })
          .on("mouseout", () => tooltip.style("display", "none")),
      (update) => update.style("stroke", (d) => getLinkColor(d)),
      (exit) => exit.remove()
    );

  // JOIN — Nodes
  nodeSel = nodeLayer
    .selectAll("circle")
    .data(nodes, (d) => String(d.id))
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("r", 12)
          .attr("fill", (d) => getNodeColor(d))
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5)
          .call(
            d3
              .drag()
              .on("start", (event) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
              })
              .on("drag", (event) => {
                event.subject.fx = event.x;
                event.subject.fy = event.y;
              })
              .on("end", (event) => {
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
              })
          )
          .on("mouseover", (event, d) => {
            const props = d.properties || {};
            const lines = Object.entries(props).map(([k, v]) => `${k}: ${v}`);
            tooltip
              .style("display", "block")
              .style("left", event.pageX + 10 + "px")
              .style("top", event.pageY + 10 + "px")
              .html(`<strong>${d.id}</strong><br>${lines.join("<br>")}`);
          })
          .on("mouseout", () => tooltip.style("display", "none")),
      (update) =>
        update
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5)
          .attr("fill", (d) => getNodeColor(d)),
      (exit) => exit.remove()
    );

  // JOIN — Labels
  labelSel = labelLayer
    .selectAll("text")
    .data(nodes, (d) => String(d.id))
    .join(
      (enter) =>
        enter
          .append("text")
          .attr("dy", -10)
          .attr("text-anchor", "middle")
          .text((d) => d.id)
          .style("font-size", "14px")
          .style("font-weight", "bold")
          .style("fill", "#0f0"),
      (update) => update.text((d) => d.id),
      (exit) => exit.remove()
    );

  // Feed the same arrays to the simulation (no cloning)
  simulation.nodes(nodes);
  simulation.force("link").id((d) => d.id).links(links);

  // Refresh colors (in case properties changed)
  linkSel.style("stroke", (d) => getLinkColor(d));
  nodeSel.attr("fill", (d) => getNodeColor(d));

  // Persist link keys for topology-change detection
  linkKeySet = new Set(links.map((l) => l._key));

  // Restart gently
  simulation.alpha(0.7).restart();

  // Restore zoom transform
  graph.attr("transform", t);
}


  // Only update properties/colors (topology unchanged)
  function updateGraphProperties(newData) {
    let currentRed = new Set();

    // Update node properties in-place
    newData.nodes.forEach((n) => {
      const existing = nodeMap.get(n.id);
      if (existing) {
        if (!existing.properties) existing.properties = {};
        Object.keys(existing.properties).forEach((k) => delete existing.properties[k]);
        Object.assign(existing.properties, n.properties || {});
        const status = nodeStatus(existing.properties);
        if (status === "RED") currentRed.add(String(n.id));
      }
    });

    // Update link properties in-place
    linkSel.each(function (d) {
      const srcId = typeof d.source === "object" ? d.source.id : d.source;
      const tgtId = typeof d.target === "object" ? d.target.id : d.target;
      const k = normKey(srcId, tgtId);

      const updatedLink = newData.links.find(
        (l) => normKey(l.source, l.target) === k
      );

      if (updatedLink) {
        d.properties = { ...(d.properties || {}), ...(updatedLink.properties || {}) };

        // Ensure endpoint properties are up to date on bound objects
        if (typeof d.source === "object") {
          Object.assign(
            d.source.properties || (d.source.properties = {}),
            nodeMap.get(srcId)?.properties || {}
          );
        }
        if (typeof d.target === "object") {
          Object.assign(
            d.target.properties || (d.target.properties = {}),
            nodeMap.get(tgtId)?.properties || {}
          );
        }

        const lp = nodeStatus(d.properties);
        if (lp === "RED") currentRed.add(k);
      }
    });

    // New RED detection
    const hasNewRed = Array.from(currentRed).some(
      (id) => !previousRedEntities.has(id)
    );
    alertIndicator.classList.toggle("hidden", !hasNewRed);
    previousRedEntities = currentRed;

    // Update colors
    nodeSel
      .transition()
      .duration(300)
      .attr("fill", (d) => getNodeColor(d));

    linkSel
      .transition()
      .duration(300)
      .style("stroke", (d) => getLinkColor(d));

    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

  function hasTopologyChanged(newData) {
    // Compare node ids
    const currentIds = new Set(Array.from(nodeMap.keys()).map(String));
    const newIds = new Set(newData.nodes.map((n) => String(n.id)));
    if (currentIds.size !== newIds.size) return true;
    for (const id of newIds) if (!currentIds.has(id)) return true;

    // Compare link keys
    const newKeys = new Set(
      newData.links.map((l) => normKey(l.source, l.target))
    );
    if (linkKeySet.size !== newKeys.size) return true;
    for (const k of newKeys) if (!linkKeySet.has(k)) return true;

    return false;
  }

  // Poller
  function poll() {
    if (isPaused || inFlight) return;
    inFlight = true;
    const ts = Date.now();

    d3.json(`${dataUrl}?t=${ts}`)
      .then((newData) => {
        inFlight = false;
        if (!newData?.nodes?.length) {
          lastUpdated.textContent = `Last update: no data at ${new Date().toLocaleTimeString()}`;
          return;
        }
        try {
          if (hasTopologyChanged(newData)) {
            buildGraph(newData);
          } else {
            updateGraphProperties(newData);
          }
        } catch (e) {
          // Fallback: full rebuild on any update error
          console.warn("Incremental update failed, rebuilding graph", e);
          buildGraph(newData);
        }
      })
      .catch(() => {
        inFlight = false;
        lastUpdated.textContent = `Last update failed at ${new Date().toLocaleTimeString()}`;
      });
  }

  // Start/refresh interval
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = setInterval(poll, 5000);

  // Initial load
  d3.json(dataUrl)
    .then((data) => {
      if (!data?.nodes?.length) {
        throw new Error("No data received");
      }
      document.getElementById("loader").classList.add("hidden");
      buildGraph(data);
      lastUpdated.textContent = `Loaded at ${new Date().toLocaleTimeString()}`;
    })
    .catch((err) => {
      const loader = document.getElementById("loader");
      const text = loader?.querySelector(".loader-text");
      if (text) text.textContent = "Failed to load. Retrying...";
      // Try once more after a short delay
      setTimeout(() => {
        d3.json(dataUrl)
          .then((data) => {
            document.getElementById("loader").classList.add("hidden");
            buildGraph(data);
            lastUpdated.textContent = `Loaded at ${new Date().toLocaleTimeString()}`;
          })
          .catch(() => {
            if (text) text.textContent = "Unable to load data. Check the source.";
          });
      }, 2000);
    });

  // Cleanup if needed by caller (optional: attach to container)
  container._destroyTopology = () => {
    try {
      clearInterval(refreshIntervalId);
    } catch {}
    simulation.stop();
    window.removeEventListener("resize", recenter);
  };
}

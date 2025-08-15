import { renderPathForm } from './pathFinder.js';
import { renderTopology } from './topology.js';
import { renderAIAnalysis } from './aiAnalysis.js';

let previousView = null; // Track previous tab

// ✅ Highlight active sidebar tab
function setActiveTab(view) {
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('bg-gray-800', isActive);  // Active background
    btn.classList.toggle('text-white', isActive);    // Active text
    btn.classList.toggle('text-gray-400', !isActive); // Inactive text
  });
}

window.loadView = async function(view) {
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="text-green-400 p-4 animate-pulse">
      Loading <strong>${view}</strong> view...
    </div>
  `;

  // 🔁 AI backend start/stop logic
  if (view === 'aiAnalysis' && previousView !== 'aiAnalysis') {
    try {
      await fetch('/ai-analysis/start', { method: 'POST' });
      console.log('✅ AI analysis backend started');
    } catch (e) {
      console.error('❌ Failed to start AI analysis backend', e);
    }
  } else if (previousView === 'aiAnalysis' && view !== 'aiAnalysis') {
    try {
      await fetch('/ai-analysis/stop', { method: 'POST' });
      console.log('🛑 AI analysis backend stopped');
    } catch (e) {
      console.error('❌ Failed to stop AI analysis backend', e);
    }
  }

  previousView = view;
  setActiveTab(view); // ✅ Update active tab

  // 👇 Load tab views
  if (view === 'path') {
    renderPathForm('mainContent');
  } else if (view === 'realtime') {
    renderTopology('mainContent', '/static/graph-data/graph_live.json');
  } else if (view === 'predictedLat') {
    renderTopology('mainContent', '/static/graph-data/graph_live_predicted.json');
  } else if (view === 'predictedAlarm') {
    renderTopology('mainContent', '/static/graph-data/graph_live_alarm_predicted.json');
  } else if (view === 'aiAnalysis') {
    renderAIAnalysis('mainContent');
  } else {
    container.innerHTML = '<p class="text-red-500">Unknown view</p>';
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadView('path');

  const toggleBtn = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  const arrowIcon = document.getElementById('toggleIcon');

  toggleBtn.addEventListener('click', () => {
    const isCollapsed = sidebar.getAttribute('data-collapsed') === 'true';
    const newState = !isCollapsed;

    sidebar.setAttribute('data-collapsed', String(newState));
    sidebar.classList.toggle('w-64', newState);
    sidebar.classList.toggle('w-16', !newState);

    // Hide all labels and footer
    sidebar.querySelectorAll('.label, .toggle-label, .sidebar-footer').forEach(el => {
      el.classList.toggle('hidden', !newState);
    });

    arrowIcon.classList.toggle('rotate-180', newState);
  });

  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      loadView(view);
    });
  });
});

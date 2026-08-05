// heatmap.js - Generates a GitHub-style activity heatmap for Codeforces solves

/**
 * Generates the heatmap grid and populates it based on accepted submissions.
 * @param {Array} submissions - The list of accepted submissions.
 * @param {HTMLElement} container - The DOM element to append the heatmap to.
 */
export function renderHeatmap(submissions, container) {
  container.innerHTML = '';
  
  // We want to show the last 52 weeks (approx 1 year).
  const cols = 52;
  const rows = 7;
  
  // Create a map of date -> count
  const dateCounts = new Map();
  let maxCount = 0;
  
  submissions.forEach(sub => {
    const d = new Date(sub.creationTimeSeconds * 1000);
    // Use local or UTC? We'll stick to local time since that's what user experiences
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const curr = (dateCounts.get(key) || 0) + 1;
    dateCounts.set(key, curr);
    if (curr > maxCount) maxCount = curr;
  });

  // Calculate start date (52 weeks ago from this past Sunday, or today if Sunday)
  const today = new Date();
  // Set to start of today
  today.setHours(0, 0, 0, 0);
  
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (cols * 7) + 1);
  
  // Tooltip element — position: fixed so scrolling doesn't misplace it
  let tooltip = document.getElementById('tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'tooltip';
    tooltip.style.position = 'fixed';
    document.body.appendChild(tooltip);
  }

  // Create grid
  for (let c = 0; c < cols; c++) {
    const colDiv = document.createElement('div');
    colDiv.style.display = 'flex';
    colDiv.style.flexDirection = 'column';
    colDiv.style.gap = '4px';

    for (let r = 0; r < rows; r++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + (c * 7) + r);
      
      const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth()+1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
      const count = dateCounts.get(key) || 0;
      
      const cell = document.createElement('div');
      cell.classList.add('heatmap-cell');
      
      if (count > 0) {
        // Determine intensity level (1-4)
        const ratio = count / maxCount;
        let level = 1;
        if (ratio > 0.25) level = 2;
        if (ratio > 0.5) level = 3;
        if (ratio > 0.75) level = 4;
        cell.classList.add(`h-${level}`);
      }
      
      // Stop rendering if cellDate > today
      if (cellDate > today) {
        cell.style.visibility = 'hidden';
      }

      // Tooltip logic
      cell.addEventListener('mouseenter', (e) => {
        if (cellDate > today) return;
        const rect = cell.getBoundingClientRect();
        tooltip.textContent = `${count} submission${count !== 1 ? 's' : ''} on ${cellDate.toLocaleDateString()}`;
        tooltip.style.opacity = 1;
        tooltip.style.left = `${rect.left - (tooltip.offsetWidth / 2) + 6}px`;
        tooltip.style.top = `${rect.top - 34}px`;
      });
      
      cell.addEventListener('mouseleave', () => {
        tooltip.style.opacity = 0;
      });

      colDiv.appendChild(cell);
    }
    container.appendChild(colDiv);
  }
}

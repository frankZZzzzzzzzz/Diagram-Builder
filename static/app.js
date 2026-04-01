const canvas = document.getElementById("canvas");
const viewport = document.getElementById("canvas-viewport");
const stage = document.getElementById("canvas-stage");
const svg = document.getElementById("connections");
const connectionHitLayer = document.getElementById("connection-hit-layer");
const template = document.getElementById("node-template");
const statusText = document.getElementById("status-text");
const nodeTitleInput = document.getElementById("node-title");
const nodeBodyInput = document.getElementById("node-body");
const nodeColorInput = document.getElementById("node-color");
const savePresetButton = document.getElementById("save-preset");
const colorPresetsContainer = document.getElementById("color-presets");
const colorPopover = document.getElementById("color-popover");
const popoverSwatches = document.getElementById("popover-swatches");
const popoverColorInput = document.getElementById("popover-color-input");
const popoverPresetNameInput = document.getElementById("popover-preset-name");
const popoverSavePresetButton = document.getElementById("popover-save-preset");
const presetContextMenu = document.getElementById("preset-context-menu");
const deletePresetAction = document.getElementById("delete-preset-action");
const connectToggle = document.getElementById("connect-toggle");
const deleteSelectedButton = document.getElementById("delete-selected");
const saveButton = document.getElementById("save-json");
const loadInput = document.getElementById("load-json");
const autosaveIndicator = document.getElementById("autosave-indicator");
const zoomOutButton = document.getElementById("zoom-out");
const zoomInButton = document.getElementById("zoom-in");
const zoomLevelBadge = document.getElementById("zoom-level");

const STORAGE_KEY = "diagram_builder_autosave_v1";
const PRESET_STORAGE_KEY = "diagram_builder_color_presets_v1";
const MAX_POPOVER_PRESETS = 8;
const MIN_CANVAS_WIDTH = 2400;
const MIN_CANVAS_HEIGHT = 1800;
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 120;
const ARROWHEAD_LENGTH = 22;
const ARROWHEAD_HALF_WIDTH = 9;
const ARROWHEAD_HITBOX_LENGTH = 24;
const ARROWHEAD_HITBOX_HALF_WIDTH = 10;
const MIN_TEXT_NODE_WIDTH = 160;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;
const PRESET_COLORS = {
  ocean: "#176b87",
  sunset: "#c25b2c",
  moss: "#5b7f38",
  plum: "#7c4d8b",
};
let customPresets = {};

let diagram = {
  nodes: [],
  edges: [],
};

let selectedNodeId = null;
let selectedEdgeId = null;
let connectMode = false;
let deleteMode = false;
let connectSourceId = null;
let dragState = null;
let resizeState = null;
let textNodeInteractState = null;
let panState = null;
let popoverDragState = null;
let colorPopoverNodeId = null;
let zoomLevel = 1;
let viewportInitialized = false;
let textEditSessionKey = null;
let historyPast = [];
let historyFuture = [];
let paletteDragState = null;
let presetContextState = null;
let canvasMetrics = {
  logicalWidth: 0,
  logicalHeight: 0,
};

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function defaultNodeContent() {
  return {
    title: "Box",
    body: "Describe the action or step in this box.",
    color: PRESET_COLORS.ocean,
    preset: "ocean",
  };
}

function defaultTextContent() {
  return {
    title: "Text",
    body: "",
    color: PRESET_COLORS.ocean,
    preset: null,
  };
}

function setStatus(message) {
  statusText.textContent = message;
}

function setInteractionLock(locked) {
  document.body.classList.toggle("is-interacting", locked);
}

function closeColorPopover() {
  colorPopoverNodeId = null;
  popoverDragState = null;
  colorPopover.classList.remove("is-dragging");
  colorPopover.classList.add("hidden");
}

function closePresetContextMenu() {
  presetContextState = null;
  presetContextMenu.classList.add("hidden");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function snapshotState() {
  return JSON.stringify({
    diagram,
    customPresets,
    selectedNodeId,
    selectedEdgeId,
    connectSourceId,
  });
}

function restoreSnapshot(snapshot) {
  const parsed = JSON.parse(snapshot);
  diagram = parsed.diagram;
  customPresets = parsed.customPresets || {};
  selectedNodeId = parsed.selectedNodeId;
  selectedEdgeId = parsed.selectedEdgeId;
  connectSourceId = parsed.connectSourceId;
  saveCustomPresets();
  syncInspector();
  render();
  saveAutosave();
}

function pushHistory() {
  const snapshot = snapshotState();
  if (historyPast.at(-1) === snapshot) {
    return;
  }
  historyPast.push(snapshot);
  if (historyPast.length > 100) {
    historyPast.shift();
  }
  historyFuture = [];
}

function undoHistory() {
  if (!historyPast.length) {
    setStatus("Nothing to undo.");
    return;
  }
  const current = snapshotState();
  const previous = historyPast.pop();
  historyFuture.push(current);
  restoreSnapshot(previous);
  closeColorPopover();
  textEditSessionKey = null;
  setStatus("Undid the last change.");
}

function redoHistory() {
  if (!historyFuture.length) {
    setStatus("Nothing to redo.");
    return;
  }
  const current = snapshotState();
  const next = historyFuture.pop();
  historyPast.push(current);
  restoreSnapshot(next);
  closeColorPopover();
  textEditSessionKey = null;
  setStatus("Redid the last change.");
}

function beginTextEditSession(key) {
  if (textEditSessionKey === key) {
    return;
  }
  pushHistory();
  textEditSessionKey = key;
}

function endTextEditSession() {
  textEditSessionKey = null;
}

function getCanvasPoint(clientX, clientY) {
  const viewportRect = viewport.getBoundingClientRect();
  return {
    x: (clientX - viewportRect.left + canvas.scrollLeft) / zoomLevel,
    y: (clientY - viewportRect.top + canvas.scrollTop) / zoomLevel,
  };
}

function getCanvasPointFromCanvasRect(clientX, clientY) {
  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: (clientX - canvasRect.left + canvas.scrollLeft) / zoomLevel,
    y: (clientY - canvasRect.top + canvas.scrollTop) / zoomLevel,
  };
}

function updateViewportMetrics() {
  const baseWidth = Math.max(MIN_CANVAS_WIDTH, Math.round(canvas.clientWidth / zoomLevel));
  const baseHeight = Math.max(MIN_CANVAS_HEIGHT, Math.round(canvas.clientHeight / zoomLevel));
  let logicalWidth = baseWidth;
  let logicalHeight = baseHeight;

  diagram.nodes.forEach((node) => {
    logicalWidth = Math.max(logicalWidth, Math.ceil(node.x + node.width + 120));
    logicalHeight = Math.max(logicalHeight, Math.ceil(node.y + node.height + 120));
  });

  canvasMetrics.logicalWidth = logicalWidth;
  canvasMetrics.logicalHeight = logicalHeight;

  viewport.style.width = `${logicalWidth * zoomLevel}px`;
  viewport.style.height = `${logicalHeight * zoomLevel}px`;
  stage.style.width = `${logicalWidth}px`;
  stage.style.height = `${logicalHeight}px`;
  stage.style.transform = `scale(${zoomLevel})`;
  svg.setAttribute("width", `${logicalWidth}`);
  svg.setAttribute("height", `${logicalHeight}`);
  zoomLevelBadge.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function getDiagramBounds() {
  if (!diagram.nodes.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: MIN_CANVAS_WIDTH,
      maxY: MIN_CANVAS_HEIGHT,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  diagram.nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });

  return { minX, minY, maxX, maxY };
}

function centerViewportOnDiagram() {
  const bounds = getDiagramBounds();
  const centerX = ((bounds.minX + bounds.maxX) / 2) * zoomLevel;
  const centerY = ((bounds.minY + bounds.maxY) / 2) * zoomLevel;
  const maxScrollLeft = Math.max(0, viewport.offsetWidth - canvas.clientWidth);
  const maxScrollTop = Math.max(0, viewport.offsetHeight - canvas.clientHeight);

  canvas.scrollLeft = clamp(centerX - canvas.clientWidth / 2, 0, maxScrollLeft);
  canvas.scrollTop = clamp(centerY - canvas.clientHeight / 2, 0, maxScrollTop);
}

function allPresetColors() {
  return {
    ...PRESET_COLORS,
    ...customPresets,
  };
}

function saveCustomPresets() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(customPresets));
}

function deletePreset(preset) {
  if (!(preset in customPresets)) {
    setStatus("Built-in presets cannot be deleted.");
    return;
  }
  pushHistory();
  delete customPresets[preset];
  diagram.nodes.forEach((node) => {
    if (node.preset === preset) {
      node.preset = null;
    }
  });
  saveCustomPresets();
  syncInspector();
  render();
  saveAutosave();
  if (colorPopoverNodeId) {
    openNodeColorPopover(colorPopoverNodeId);
  }
  closePresetContextMenu();
  setStatus(`Deleted preset "${preset}".`);
}

function openPresetContextMenu(event, preset) {
  event.preventDefault();
  event.stopPropagation();
  const isCustom = preset in customPresets;
  presetContextState = { preset, isCustom };
  deletePresetAction.disabled = !isCustom;

  presetContextMenu.classList.remove("hidden");
  const menuWidth = Math.ceil(presetContextMenu.offsetWidth || 150);
  const menuHeight = Math.ceil(presetContextMenu.offsetHeight || 54);
  const gap = 10;
  const left = clamp(
    event.clientX + gap,
    12,
    window.innerWidth - menuWidth - 12,
  );
  const top = clamp(
    event.clientY + gap,
    12,
    window.innerHeight - menuHeight - 12,
  );

  presetContextMenu.style.left = `${left}px`;
  presetContextMenu.style.top = `${top}px`;
}

function loadCustomPresets() {
  const raw = localStorage.getItem(PRESET_STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      customPresets = parsed;
    }
  } catch {
    customPresets = {};
  }
}

function renderPresetButtons() {
  colorPresetsContainer.innerHTML = "";
  Object.entries(allPresetColors()).forEach(([preset, color]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-preset";
    button.dataset.preset = preset;
    button.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
    button.style.setProperty("--preset-color", color);
    button.classList.toggle("is-active", !!selectedNodeId && findNode(selectedNodeId)?.preset === preset);
    button.addEventListener("click", () => {
      const node = findNode(selectedNodeId);
      if (!node) {
        setStatus("Select a box first to apply a preset color.");
        return;
      }
      applyNodeColor(selectedNodeId, color, preset);
      setStatus("Applied a color preset to the selected box.");
    });
    button.addEventListener("contextmenu", (event) => {
      openPresetContextMenu(event, preset);
    });
    colorPresetsContainer.appendChild(button);
  });
}

function applyNodeColor(nodeId, color, preset = null) {
  const node = findNode(nodeId);
  if (!node) {
    return;
  }
  pushHistory();
  node.color = color;
  node.preset = preset;
  syncInspector();
  render();
  saveAutosave();
}

function openNodeColorPopover(nodeId) {
  const node = findNode(nodeId);
  if (!node) {
    return;
  }

  colorPopoverNodeId = nodeId;
  popoverSwatches.innerHTML = "";
  Object.entries(allPresetColors()).slice(0, MAX_POPOVER_PRESETS).forEach(([preset, color]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popover-swatch";
    button.title = preset;
    button.innerHTML = `
      <span class="popover-swatch-chip" style="background:${color}"></span>
      <span class="popover-swatch-name">${preset}</span>
    `;
    button.addEventListener("click", () => {
      applyNodeColor(nodeId, color, preset);
      setStatus("Applied a color preset to the selected box.");
      closeColorPopover();
    });
    button.addEventListener("contextmenu", (event) => {
      openPresetContextMenu(event, preset);
    });
    popoverSwatches.appendChild(button);
  });

  popoverColorInput.value = node.color || PRESET_COLORS.ocean;
  popoverPresetNameInput.value = "";

  colorPopover.style.visibility = "hidden";
  colorPopover.classList.remove("hidden");
  const popoverWidth = colorPopover.offsetWidth || 240;
  const popoverHeight = colorPopover.offsetHeight || 252;
  const gap = 16;
  const nodeLeft = node.x * zoomLevel;
  const nodeTop = node.y * zoomLevel;
  const nodeRight = (node.x + node.width) * zoomLevel;
  const nodeBottom = (node.y + node.height) * zoomLevel;
  const canvasRect = canvas.getBoundingClientRect();
  const nodeScreenLeft = canvasRect.left - canvas.scrollLeft + nodeLeft;
  const nodeScreenTop = canvasRect.top - canvas.scrollTop + nodeTop;
  const nodeScreenRight = canvasRect.left - canvas.scrollLeft + nodeRight;
  const nodeScreenBottom = canvasRect.top - canvas.scrollTop + nodeBottom;
  const screenMinLeft = canvasRect.left + 12;
  const screenMaxLeft = canvasRect.right - popoverWidth - 12;
  const screenMinTop = canvasRect.top + 12;
  const screenMaxTop = canvasRect.bottom - popoverHeight - 12;
  const spaceRight = canvasRect.right - nodeScreenRight;
  const spaceLeft = nodeScreenLeft - canvasRect.left;
  const spaceBelow = canvasRect.bottom - nodeScreenBottom;
  const spaceAbove = nodeScreenTop - canvasRect.top;

  let preferredLeft;
  let preferredTop;

  if (spaceRight >= popoverWidth + gap) {
    preferredLeft = nodeScreenRight + gap;
    preferredTop = nodeScreenTop;
  } else if (spaceLeft >= popoverWidth + gap) {
    preferredLeft = nodeScreenLeft - popoverWidth - gap;
    preferredTop = nodeScreenTop;
  } else if (spaceBelow >= popoverHeight + gap) {
    preferredLeft = nodeScreenLeft;
    preferredTop = nodeScreenBottom + gap;
  } else if (spaceAbove >= popoverHeight + gap) {
    preferredLeft = nodeScreenLeft;
    preferredTop = nodeScreenTop - popoverHeight - gap;
  } else {
    const rightOption = {
      left: screenMaxLeft,
      top: clamp(nodeScreenTop, screenMinTop, Math.max(screenMinTop, screenMaxTop)),
      overlap: Math.max(0, nodeScreenRight + gap - screenMaxLeft),
    };
    const leftOption = {
      left: screenMinLeft,
      top: clamp(nodeScreenTop, screenMinTop, Math.max(screenMinTop, screenMaxTop)),
      overlap: Math.max(0, (screenMinLeft + popoverWidth + gap) - nodeScreenLeft),
    };
    const belowOption = {
      left: clamp(nodeScreenLeft, screenMinLeft, Math.max(screenMinLeft, screenMaxLeft)),
      top: screenMaxTop,
      overlap: Math.max(0, nodeScreenBottom + gap - screenMaxTop),
    };
    const aboveOption = {
      left: clamp(nodeScreenLeft, screenMinLeft, Math.max(screenMinLeft, screenMaxLeft)),
      top: screenMinTop,
      overlap: Math.max(0, (screenMinTop + popoverHeight + gap) - nodeScreenTop),
    };
    const bestOption = [rightOption, leftOption, belowOption, aboveOption]
      .sort((a, b) => a.overlap - b.overlap)[0];
    preferredLeft = bestOption.left;
    preferredTop = bestOption.top;
  }

  const clampedScreenLeft = clamp(preferredLeft, screenMinLeft, Math.max(screenMinLeft, screenMaxLeft));
  const clampedScreenTop = clamp(preferredTop, screenMinTop, Math.max(screenMinTop, screenMaxTop));
  const canvasSpaceLeft = clampedScreenLeft - canvasRect.left + canvas.scrollLeft;
  const canvasSpaceTop = clampedScreenTop - canvasRect.top + canvas.scrollTop;

  colorPopover.style.left = `${canvasSpaceLeft}px`;
  colorPopover.style.top = `${canvasSpaceTop}px`;
  colorPopover.style.visibility = "";
}

function saveAutosave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(diagram));
  autosaveIndicator.textContent = "Autosaved locally";
}

function loadAutosave() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return false;
  }

  try {
    diagram = JSON.parse(raw);
    if (!Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function findNode(nodeId) {
  return diagram.nodes.find((node) => node.id === nodeId) || null;
}

function removeNode(nodeId) {
  pushHistory();
  diagram.nodes = diagram.nodes.filter((node) => node.id !== nodeId);
  diagram.edges = diagram.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  if (selectedNodeId === nodeId) {
    selectedNodeId = null;
    syncInspector();
  }
  if (connectSourceId === nodeId) {
    connectSourceId = null;
  }
  render();
  saveAutosave();
}

function removeEdge(edgeId) {
  pushHistory();
  const edge = diagram.edges.find((item) => item.id === edgeId);
  const reciprocalEdge = edge
    ? diagram.edges.find((item) => item.from === edge.to && item.to === edge.from)
    : null;

  diagram.edges = diagram.edges.filter((item) => {
    if (item.id === edgeId) {
      return false;
    }
    if (reciprocalEdge && item.id === reciprocalEdge.id) {
      return false;
    }
    return true;
  });

  if (selectedEdgeId === edgeId || (reciprocalEdge && selectedEdgeId === reciprocalEdge.id)) {
    selectedEdgeId = null;
  }
  render();
  saveAutosave();
}

function addNode(type, x, y) {
  pushHistory();
  const content = type === "text" ? defaultTextContent() : defaultNodeContent();
  diagram.nodes.push({
    id: createId("node"),
    type,
    x,
    y,
    width: type === "text" ? 280 : DEFAULT_NODE_WIDTH,
    height: type === "text" ? 56 : DEFAULT_NODE_HEIGHT,
    title: content.title,
    body: content.body,
    color: content.color,
    preset: content.preset,
  });
  selectedNodeId = diagram.nodes.at(-1).id;
  syncInspector();
  render();
  saveAutosave();
  setStatus("Added a new box to the canvas.");
}

function addEdge(from, to) {
  if (from === to) {
    return;
  }
  if (diagram.edges.some((edge) => edge.from === from && edge.to === to)) {
    return;
  }
  pushHistory();
  diagram.edges.push({ id: createId("edge"), from, to });
  render();
  saveAutosave();
  setStatus("Connected the selected boxes.");
}

function selectNode(nodeId, shouldRender = true) {
  selectedNodeId = nodeId;
  selectedEdgeId = null;
  syncInspector();
  if (shouldRender) {
    render();
  }
}

function selectEdge(edgeId) {
  selectedEdgeId = edgeId;
  selectedNodeId = null;
  closeColorPopover();
  syncInspector();
  render();
}

function syncInspector() {
  const node = findNode(selectedNodeId);
  nodeTitleInput.disabled = !node;
  nodeBodyInput.disabled = !node || node.type === "text";
  nodeColorInput.disabled = !node || node.type === "text";
  nodeTitleInput.value = node ? node.title : "";
  nodeTitleInput.placeholder = node?.type === "text" ? "Edit selected text" : "Select a box to edit";
  nodeBodyInput.value = node ? node.body : "";
  nodeColorInput.value = node ? (node.color || PRESET_COLORS.ocean) : PRESET_COLORS.ocean;
  renderPresetButtons();
}

function setConnectMode(enabled) {
  connectMode = enabled;
  connectToggle.classList.toggle("is-active", enabled);
  if (enabled) {
    deleteMode = false;
    deleteSelectedButton.classList.remove("is-active");
  }
  connectSourceId = null;
  render();
  setStatus(
    enabled
      ? "Connect mode is on. Click one box, then click another box."
      : "Connect mode is off.",
  );
}

function setDeleteMode(enabled) {
  deleteMode = enabled;
  deleteSelectedButton.classList.toggle("is-active", enabled);
  if (enabled) {
    connectMode = false;
    connectToggle.classList.remove("is-active");
    connectSourceId = null;
  }
  render();
  setStatus(
    enabled
      ? "Delete mode is on. Click any box or connection to remove it."
      : "Delete mode is off.",
  );
}

function clearSelectionState() {
  selectedNodeId = null;
  selectedEdgeId = null;
  connectSourceId = null;
  closeColorPopover();
  syncInspector();
  render();
}

function destroyPaletteGhost() {
  paletteDragState?.ghost?.remove();
}

function beginPaletteDrag(item, event) {
  const previewBox = item.querySelector(".palette-preview-box");
  const rect = (previewBox || item).getBoundingClientRect();
  const xRatio = rect.width ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;
  const yRatio = rect.height ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0.5;
  const offsetX = xRatio * rect.width;
  const offsetY = yRatio * rect.height;

  const ghost = (previewBox || item).cloneNode(true);
  ghost.classList.add("palette-drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.minHeight = `${rect.height}px`;
  document.body.appendChild(ghost);

  paletteDragState = {
    pointerId: event.pointerId,
    nodeType: item.dataset.nodeType,
    offsetX,
    offsetY,
    ghost,
  };

  setInteractionLock(true);
  updatePaletteGhostPosition(event.clientX, event.clientY);
}

function updatePaletteGhostPosition(clientX, clientY) {
  if (!paletteDragState?.ghost) {
    return;
  }
  paletteDragState.ghost.style.transform = `translate3d(${clientX - paletteDragState.offsetX}px, ${clientY - paletteDragState.offsetY}px, 0)`;
}

function endPaletteDrag(clientX, clientY) {
  if (!paletteDragState) {
    return;
  }

  const { nodeType, ghost } = paletteDragState;
  const canvasRect = canvas.getBoundingClientRect();
  const droppedOnCanvas =
    clientX >= canvasRect.left &&
    clientX <= canvasRect.right &&
    clientY >= canvasRect.top &&
    clientY <= canvasRect.bottom;

  if (droppedOnCanvas && nodeType && ghost) {
    const ghostRect = ghost.getBoundingClientRect();
    const topLeft = getCanvasPointFromCanvasRect(ghostRect.left, ghostRect.top);
    addNode(nodeType, topLeft.x, topLeft.y);
  }

  destroyPaletteGhost();
  paletteDragState = null;
  setInteractionLock(false);
}

function getNodeCenter(node) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function getNodeBoundaryPoint(node, targetPoint) {
  const center = getNodeCenter(node);
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;

  if (dx === 0 && dy === 0) {
    return center;
  }

  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function getArrowheadPoints(start, end, length = 12, halfWidth = 4) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  const ux = dx / magnitude;
  const uy = dy / magnitude;
  const px = -uy;
  const py = ux;

  const baseX = end.x - ux * length;
  const baseY = end.y - uy * length;

  return [
    { x: end.x, y: end.y },
    { x: baseX + px * halfWidth, y: baseY + py * halfWidth },
    { x: baseX - px * halfWidth, y: baseY - py * halfWidth },
  ];
}

function getArrowBaseCenter(start, end, length) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  const ux = dx / magnitude;
  const uy = dy / magnitude;

  return {
    x: end.x - ux * length,
    y: end.y - uy * length,
  };
}

function getReciprocalEdge(edge) {
  return diagram.edges.find((item) => item.from === edge.to && item.to === edge.from) || null;
}

function renderEdges() {
  svg.querySelectorAll(".connection-group").forEach((group) => group.remove());
  connectionHitLayer.innerHTML = "";
  connectionHitLayer.setAttribute("width", `${canvasMetrics.logicalWidth}`);
  connectionHitLayer.setAttribute("height", `${canvasMetrics.logicalHeight}`);
  connectionHitLayer.setAttribute("viewBox", `0 0 ${canvasMetrics.logicalWidth} ${canvasMetrics.logicalHeight}`);
  const processedPairs = new Set();

  diagram.edges.forEach((edge) => {
    const pairKey = [edge.from, edge.to].sort().join("::");
    if (processedPairs.has(pairKey)) {
      return;
    }

    const fromNode = findNode(edge.from);
    const toNode = findNode(edge.to);
    if (!fromNode || !toNode) {
      return;
    }
    const reciprocalEdge = getReciprocalEdge(edge);
    processedPairs.add(pairKey);

    const fromCenter = getNodeCenter(fromNode);
    const toCenter = getNodeCenter(toNode);
    const start = getNodeBoundaryPoint(fromNode, toCenter);
    const end = getNodeBoundaryPoint(toNode, fromCenter);
      const arrowheadLength = ARROWHEAD_LENGTH;
      const endArrowheadPoints = getArrowheadPoints(start, end, arrowheadLength, ARROWHEAD_HALF_WIDTH);
      const endHitTargetPoints = getArrowheadPoints(start, end, ARROWHEAD_HITBOX_LENGTH, ARROWHEAD_HITBOX_HALF_WIDTH);
      const endArrowBaseCenter = getArrowBaseCenter(start, end, arrowheadLength);
      const startArrowheadPoints = reciprocalEdge
        ? getArrowheadPoints(end, start, arrowheadLength, ARROWHEAD_HALF_WIDTH)
        : null;
      const startHitTargetPoints = reciprocalEdge
        ? getArrowheadPoints(end, start, ARROWHEAD_HITBOX_LENGTH, ARROWHEAD_HITBOX_HALF_WIDTH)
        : null;
    const startArrowBaseCenter = reciprocalEdge ? getArrowBaseCenter(end, start, arrowheadLength) : start;
    const isSelected = edge.id === selectedEdgeId || reciprocalEdge?.id === selectedEdgeId;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("connection-group");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${startArrowBaseCenter.x} ${startArrowBaseCenter.y} L ${endArrowBaseCenter.x} ${endArrowBaseCenter.y}`,
    );
    path.classList.add("connection-path");
    path.classList.toggle("is-selected", isSelected);

    const selectConnection = (event) => {
      event.stopPropagation();
      if (deleteMode) {
        removeEdge(edge.id);
        setStatus(reciprocalEdge ? "Double-sided connection deleted." : "Connection deleted.");
        return;
      }
      selectEdge(edge.id);
      setStatus(reciprocalEdge ? "Selected a double-sided connection." : "Selected a connection line.");
    };

    path.addEventListener("pointerdown", selectConnection);

    const appendArrowhead = (points) => {
      const arrowhead = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrowhead.classList.add("connection-arrowhead");
      arrowhead.classList.toggle("is-selected", isSelected);
      arrowhead.setAttribute(
        "points",
        points.map((point) => `${point.x},${point.y}`).join(" "),
      );
      arrowhead.addEventListener("pointerdown", selectConnection);
      group.appendChild(arrowhead);
    };

    const appendHitTarget = (points) => {
      const hitTarget = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      hitTarget.classList.add("connection-hit-target");
      hitTarget.setAttribute(
        "points",
        points.map((point) => `${point.x},${point.y}`).join(" "),
      );
      hitTarget.addEventListener("pointerdown", selectConnection);
      connectionHitLayer.appendChild(hitTarget);
    };

    group.appendChild(path);
    appendArrowhead(endArrowheadPoints);
    appendHitTarget(endHitTargetPoints);
    if (startArrowheadPoints && startHitTargetPoints) {
      appendArrowhead(startArrowheadPoints);
      appendHitTarget(startHitTargetPoints);
    }
    svg.appendChild(group);
  });
}

function beginDrag(event, nodeId) {
  const node = findNode(nodeId);
  if (!node) {
    return;
  }
  const point = getCanvasPoint(event.clientX, event.clientY);
  dragState = {
    nodeId,
    offsetX: point.x - node.x,
    offsetY: point.y - node.y,
    historyPushed: false,
  };
  setInteractionLock(true);
}

function focusTextNodeTitle(nodeId) {
  const title = stage.querySelector(`.diagram-node[data-id="${nodeId}"] .node-title`);
  if (!title) {
    return;
  }
  title.focus();
}

function isNodeOffCanvas(node) {
  const left = canvas.scrollLeft / zoomLevel;
  const top = canvas.scrollTop / zoomLevel;
  const right = left + canvas.clientWidth / zoomLevel;
  const bottom = top + canvas.clientHeight / zoomLevel;
  const nodeCenterX = node.x + node.width / 2;
  const nodeCenterY = node.y + node.height / 2;
  return (
    nodeCenterX < left ||
    nodeCenterY < top ||
    nodeCenterX > right ||
    nodeCenterY > bottom
  );
}

function renderNodes() {
    stage.querySelectorAll(".diagram-node").forEach((node) => node.remove());

  diagram.nodes.forEach((node) => {
    const fragment = template.content.cloneNode(true);
    const element = fragment.querySelector(".diagram-node");
    const accent = fragment.querySelector(".node-accent");
    const title = fragment.querySelector(".node-title");
    const body = fragment.querySelector(".node-body");
    const resizeHandle = fragment.querySelector(".node-resize-handle");

    element.dataset.id = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.width}px`;
    element.style.minHeight = `${node.type === "text" ? 0 : DEFAULT_NODE_HEIGHT}px`;
    element.style.setProperty("--node-color", node.color || PRESET_COLORS.ocean);
    element.classList.toggle("is-text-node", node.type === "text");
    element.classList.toggle("is-selected", node.id === selectedNodeId);
    element.classList.toggle("is-connect-source", node.id === connectSourceId);

    title.textContent = node.title;
    body.textContent = node.body;
    title.contentEditable = "true";
    body.contentEditable = node.type === "text" ? "false" : "true";
    title.spellcheck = false;
    body.spellcheck = false;
    body.hidden = node.type === "text";
    title.dataset.placeholder = node.type === "text" ? "Text" : "";
    resizeHandle.hidden = node.type !== "text" || node.id !== selectedNodeId;

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (node.type !== "text") {
        return;
      }
      event.stopPropagation();
      selectNode(node.id, false);
      resizeState = {
        nodeId: node.id,
        startClientX: event.clientX,
        startWidth: node.width,
        historyPushed: false,
      };
      setInteractionLock(true);
    });

    accent.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectNode(node.id, false);
    });
    accent.addEventListener("click", (event) => {
      if (node.type === "text") {
        return;
      }
      event.stopPropagation();
      selectNode(node.id, false);
      openNodeColorPopover(node.id);
    });

    title.addEventListener("pointerdown", (event) => {
      if (node.type === "text" && !title.classList.contains("is-editing")) {
        event.preventDefault();
        event.stopPropagation();
        selectNode(node.id, false);
        textNodeInteractState = {
          nodeId: node.id,
          startX: event.clientX,
          startY: event.clientY,
        };
        return;
      }
      event.stopPropagation();
      selectNode(node.id, false);
    });
    body.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectNode(node.id, false);
    });

    title.addEventListener("focus", () => {
      beginTextEditSession(`inline-title-${node.id}`);
      title.classList.add("is-editing");
    });
    body.addEventListener("focus", () => {
      if (node.type === "text") {
        return;
      }
      beginTextEditSession(`inline-body-${node.id}`);
      body.classList.add("is-editing");
    });

    title.addEventListener("blur", () => {
      title.classList.remove("is-editing");
      node.title = title.textContent.trim() || "Box";
      endTextEditSession();
      syncInspector();
      render();
      saveAutosave();
    });
    body.addEventListener("blur", () => {
      if (node.type === "text") {
        return;
      }
      body.classList.remove("is-editing");
      node.body = body.textContent.trim();
      endTextEditSession();
      syncInspector();
      render();
      saveAutosave();
    });

    title.addEventListener("input", () => {
      node.title = title.textContent;
      syncInspector();
      saveAutosave();
    });
    body.addEventListener("input", () => {
      if (node.type === "text") {
        return;
      }
      node.body = body.textContent;
      syncInspector();
      saveAutosave();
    });

    element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (deleteMode) {
        removeNode(node.id);
        setStatus("Box deleted.");
        return;
      }
      selectNode(node.id);

      if (connectMode) {
        if (!connectSourceId) {
          connectSourceId = node.id;
          render();
          setStatus("Source box selected. Click another box to create the arrow.");
          return;
        }
        addEdge(connectSourceId, node.id);
        connectSourceId = null;
        render();
        return;
      }

      beginDrag(event, node.id);
    });

    stage.appendChild(fragment);
    node.height = Math.max(node.type === "text" ? 0 : DEFAULT_NODE_HEIGHT, Math.ceil(element.offsetHeight));
    if (node.type !== "text") {
      node.width = Math.max(DEFAULT_NODE_WIDTH, Math.ceil(element.offsetWidth));
    }
  });
}

function render() {
  updateViewportMetrics();
  renderNodes();
  renderEdges();
}

window.addEventListener("pointermove", (event) => {
  if (paletteDragState) {
    updatePaletteGhostPosition(event.clientX, event.clientY);
    return;
  }

  if (textNodeInteractState) {
    const dx = event.clientX - textNodeInteractState.startX;
    const dy = event.clientY - textNodeInteractState.startY;
    if (Math.hypot(dx, dy) > 4) {
      beginDrag(event, textNodeInteractState.nodeId);
      textNodeInteractState = null;
    }
  }

  if (resizeState) {
    const node = findNode(resizeState.nodeId);
    if (!node) {
      return;
    }
    const nextWidth = Math.max(
      MIN_TEXT_NODE_WIDTH,
      resizeState.startWidth + (event.clientX - resizeState.startClientX) / zoomLevel,
    );
    if (!resizeState.historyPushed && nextWidth !== node.width) {
      pushHistory();
      resizeState.historyPushed = true;
    }
    node.width = nextWidth;
    render();
    return;
  }

  if (popoverDragState) {
    const canvasRect = canvas.getBoundingClientRect();
    const minLeft = canvas.scrollLeft + 12;
    const maxLeft = canvas.scrollLeft + canvas.clientWidth - colorPopover.offsetWidth - 12;
    const minTop = canvas.scrollTop + 12;
    const maxTop = canvas.scrollTop + canvas.clientHeight - colorPopover.offsetHeight - 12;
    const nextLeft = event.clientX - canvasRect.left + canvas.scrollLeft - popoverDragState.offsetX;
    const nextTop = event.clientY - canvasRect.top + canvas.scrollTop - popoverDragState.offsetY;
    colorPopover.style.left = `${clamp(nextLeft, minLeft, Math.max(minLeft, maxLeft))}px`;
    colorPopover.style.top = `${clamp(nextTop, minTop, Math.max(minTop, maxTop))}px`;
    return;
  }

  if (dragState) {
    const node = findNode(dragState.nodeId);
    if (!node) {
      return;
    }

    const point = getCanvasPoint(event.clientX, event.clientY);
    const nextX = point.x - dragState.offsetX;
    const nextY = point.y - dragState.offsetY;
    if (!dragState.historyPushed && (nextX !== node.x || nextY !== node.y)) {
      pushHistory();
      dragState.historyPushed = true;
    }
    node.x = nextX;
    node.y = nextY;
    render();
    return;
  }

  if (!panState) {
    return;
  }

  canvas.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
  canvas.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  if (colorPopoverNodeId) {
    openNodeColorPopover(colorPopoverNodeId);
  }
});

window.addEventListener("pointerup", (event) => {
  if (paletteDragState) {
    endPaletteDrag(event.clientX, event.clientY);
    return;
  }

  if (textNodeInteractState) {
    const nodeId = textNodeInteractState.nodeId;
    textNodeInteractState = null;
    selectNode(nodeId);
    requestAnimationFrame(() => {
      focusTextNodeTitle(nodeId);
    });
    return;
  }

  if (resizeState) {
    resizeState = null;
    setInteractionLock(false);
    saveAutosave();
    return;
  }

  if (popoverDragState) {
    popoverDragState = null;
    colorPopover.classList.remove("is-dragging");
    return;
  }

  if (dragState) {
    const node = findNode(dragState.nodeId);
    if (node && isNodeOffCanvas(node)) {
      const deletedId = dragState.nodeId;
      dragState = null;
      setInteractionLock(false);
      removeNode(deletedId);
      setStatus("Dragged box off the canvas and deleted it.");
      return;
    }
    dragState = null;
    setInteractionLock(false);
    saveAutosave();
  }

  if (panState) {
    panState = null;
    canvas.classList.remove("is-panning");
    setInteractionLock(false);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (
    event.target.closest(".diagram-node") ||
    event.target.closest(".color-popover") ||
    event.target.closest(".connection-group")
  ) {
    return;
  }

  closeColorPopover();
  selectedNodeId = null;
  selectedEdgeId = null;
  syncInspector();
  render();

  panState = {
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: canvas.scrollLeft,
    scrollTop: canvas.scrollTop,
  };
  canvas.classList.add("is-panning");
  setInteractionLock(true);
});

nodeTitleInput.addEventListener("input", () => {
  const node = findNode(selectedNodeId);
  if (!node) {
    return;
  }
  beginTextEditSession(`sidebar-title-${selectedNodeId}`);
  node.title = nodeTitleInput.value;
  render();
  saveAutosave();
});

nodeBodyInput.addEventListener("input", () => {
  const node = findNode(selectedNodeId);
  if (!node || node.type === "text") {
    return;
  }
  beginTextEditSession(`sidebar-body-${selectedNodeId}`);
  node.body = nodeBodyInput.value;
  render();
  saveAutosave();
});

nodeTitleInput.addEventListener("blur", endTextEditSession);
nodeBodyInput.addEventListener("blur", endTextEditSession);

nodeColorInput.addEventListener("input", () => {
  const node = findNode(selectedNodeId);
  if (!node || node.type === "text") {
    return;
  }
  applyNodeColor(selectedNodeId, nodeColorInput.value, null);
});

popoverColorInput.addEventListener("input", () => {
  if (!colorPopoverNodeId) {
    return;
  }
  applyNodeColor(colorPopoverNodeId, popoverColorInput.value, null);
});

function saveCurrentPopoverPreset() {
  if (!colorPopoverNodeId) {
    return;
  }
  const node = findNode(colorPopoverNodeId);
  if (!node) {
    return;
  }
  const presetName = popoverPresetNameInput.value.trim();
  if (!presetName) {
    setStatus("Enter a preset name first.");
    return;
  }
  const key = presetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!key) {
    setStatus("Preset name was empty.");
    return;
  }
  pushHistory();
  customPresets[key] = node.color || popoverColorInput.value;
  node.preset = key;
  saveCustomPresets();
  syncInspector();
  saveAutosave();
  openNodeColorPopover(colorPopoverNodeId);
  setStatus(`Saved preset "${presetName}".`);
}

popoverSavePresetButton.addEventListener("click", saveCurrentPopoverPreset);
deletePresetAction.addEventListener("click", () => {
  if (!presetContextState?.isCustom) {
    return;
  }
  deletePreset(presetContextState.preset);
});
popoverPresetNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveCurrentPopoverPreset();
  }
});

colorPopover.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  const interactiveTarget = event.target.closest("button, input, textarea, label");
  if (interactiveTarget) {
    return;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const currentLeft = parseFloat(colorPopover.style.left || "0");
  const currentTop = parseFloat(colorPopover.style.top || "0");
  popoverDragState = {
    offsetX: event.clientX - canvasRect.left + canvas.scrollLeft - currentLeft,
    offsetY: event.clientY - canvasRect.top + canvas.scrollTop - currentTop,
  };
  colorPopover.classList.add("is-dragging");
});

colorPopover.addEventListener("click", (event) => {
  event.stopPropagation();
});

presetContextMenu.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

presetContextMenu.addEventListener("click", (event) => {
  event.stopPropagation();
});

connectToggle.addEventListener("click", () => {
  setConnectMode(!connectMode);
});

deleteSelectedButton.addEventListener("click", () => {
  setDeleteMode(!deleteMode);
});

window.addEventListener("keydown", (event) => {
  const activeTag = document.activeElement?.tagName;
  const isEditingText =
    activeTag === "INPUT" ||
    activeTag === "TEXTAREA" ||
    document.activeElement?.isContentEditable;

  if (event.key === "Escape") {
    if (document.activeElement?.isContentEditable) {
      document.activeElement.blur();
      return;
    }
    if (isEditingText) {
      document.activeElement?.blur();
      return;
    }
    const hadOpenPopover = !colorPopover.classList.contains("hidden");
    const hadSelection = Boolean(selectedNodeId || selectedEdgeId || connectSourceId);
    const hadConnectMode = connectMode;
    const hadDeleteMode = deleteMode;

    clearSelectionState();
    if (hadConnectMode) {
      setConnectMode(false);
    } else if (hadDeleteMode) {
      setDeleteMode(false);
    } else if (hadOpenPopover || hadSelection) {
      setStatus("Selection cleared.");
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    if (isEditingText) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      redoHistory();
    } else {
      undoHistory();
    }
    return;
  }

  if (isEditingText) {
    return;
  }
  if (selectedNodeId) {
    if (event.key === "Delete" || event.key === "Backspace") {
      const nodeId = selectedNodeId;
      removeNode(nodeId);
      setStatus("Selected box deleted.");
      return;
    }
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedEdgeId) {
      const edgeId = selectedEdgeId;
      removeEdge(edgeId);
      setStatus("Selected connection deleted.");
    }
  }
});

savePresetButton.addEventListener("click", () => {
  const node = findNode(selectedNodeId);
  if (!node) {
    setStatus("Select a box first to save its color as a preset.");
    return;
  }
  const presetName = window.prompt("Name this preset:", "custom");
  if (!presetName) {
    return;
  }
  const key = presetName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!key) {
    setStatus("Preset name was empty.");
    return;
  }
  pushHistory();
  customPresets[key] = node.color || nodeColorInput.value;
  node.preset = key;
  saveCustomPresets();
  syncInspector();
  saveAutosave();
  setStatus(`Saved preset "${presetName.trim()}".`);
});

document.querySelectorAll(".palette-preview").forEach((item) => {
  item.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    beginPaletteDrag(item, event);
  });
});

function setZoom(nextZoom) {
  const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  if (clampedZoom === zoomLevel) {
    return;
  }
  zoomLevel = Number(clampedZoom.toFixed(2));
  render();
  if (colorPopoverNodeId) {
    openNodeColorPopover(colorPopoverNodeId);
  }
  setStatus(`Canvas zoom set to ${Math.round(zoomLevel * 100)}%.`);
}

function setZoomAt(nextZoom, clientX, clientY) {
  const previousZoom = zoomLevel;
  const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  if (clampedZoom === previousZoom) {
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const viewX = clientX - canvasRect.left;
  const viewY = clientY - canvasRect.top;
  const contentX = (canvas.scrollLeft + viewX) / previousZoom;
  const contentY = (canvas.scrollTop + viewY) / previousZoom;

  zoomLevel = Number(clampedZoom.toFixed(2));
  render();

  const maxScrollLeft = Math.max(0, viewport.offsetWidth - canvas.clientWidth);
  const maxScrollTop = Math.max(0, viewport.offsetHeight - canvas.clientHeight);
  canvas.scrollLeft = clamp(contentX * zoomLevel - viewX, 0, maxScrollLeft);
  canvas.scrollTop = clamp(contentY * zoomLevel - viewY, 0, maxScrollTop);

  if (colorPopoverNodeId) {
    openNodeColorPopover(colorPopoverNodeId);
  }
  setStatus(`Canvas zoom set to ${Math.round(zoomLevel * 100)}%.`);
}

zoomInButton.addEventListener("click", () => {
  setZoom(zoomLevel + ZOOM_STEP);
});

zoomOutButton.addEventListener("click", () => {
  setZoom(zoomLevel - ZOOM_STEP);
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const direction = event.deltaY > 0 ? -1 : 1;
  const step = zoomLevel <= 0.25 ? 0.05 : ZOOM_STEP;
  setZoomAt(zoomLevel + direction * step, event.clientX, event.clientY);
}, { passive: false });

window.addEventListener("resize", () => {
  render();
});

function exportDiagram() {
  const payload = JSON.stringify(diagram, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "diagram.json";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Diagram saved as a JSON file.");
}

function importDiagram(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error("Invalid diagram format.");
      }
      pushHistory();
      diagram = parsed;
      selectedNodeId = null;
      selectedEdgeId = null;
      connectSourceId = null;
      syncInspector();
      render();
      saveAutosave();
      setStatus("Diagram loaded successfully.");
    } catch {
      setStatus("That file could not be loaded as a diagram.");
    }
  };
  reader.readAsText(file);
}

saveButton.addEventListener("click", exportDiagram);

loadInput.addEventListener("change", () => {
  const [file] = loadInput.files;
  if (file) {
    importDiagram(file);
  }
  loadInput.value = "";
});

document.addEventListener("pointerdown", (event) => {
  if (!presetContextMenu.classList.contains("hidden") && !presetContextMenu.contains(event.target)) {
    closePresetContextMenu();
  }
  if (colorPopover.classList.contains("hidden")) {
    return;
  }
  if (colorPopover.contains(event.target)) {
    return;
  }
  if (event.target.classList?.contains("node-accent")) {
    return;
  }
  closeColorPopover();
});

if (loadAutosave()) {
  loadCustomPresets();
  diagram.nodes = diagram.nodes.map((node) => ({
    ...node,
    type: node.type || "box",
    color: node.color || PRESET_COLORS.ocean,
    preset: node.preset || "ocean",
    width: node.width || (node.type === "text" ? 280 : DEFAULT_NODE_WIDTH),
    height: node.height || (node.type === "text" ? 56 : DEFAULT_NODE_HEIGHT),
  }));
  setStatus("Restored your last autosaved diagram.");
} else {
  loadCustomPresets();
  addNode("box", 760, 520);
  addNode("box", 1060, 620);
  diagram.edges = [{ id: createId("edge"), from: diagram.nodes[0].id, to: diagram.nodes[1].id }];
  saveAutosave();
  setStatus("A starter diagram has been created for you.");
}

syncInspector();
render();
if (!viewportInitialized) {
  centerViewportOnDiagram();
  viewportInitialized = true;
}
historyPast = [];
historyFuture = [];

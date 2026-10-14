
"use strict";

/* =========================================
   길벗 지도 제작소
   초보자용 학교 지도 편집기
   ========================================= */

const GRID_SIZE = 25;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;
const STORAGE_KEY = "gilbeot-map-data-v2";

const COLORS = {
  classroom: "#93c5fd",
  corridor: "#cbd5e1",
  stairs: "#c4b5fd",
  restroom: "#f9a8d4",
  entrance: "#86efac",
  elevator: "#67e8f9",
  office: "#fde68a",
  other: "#d1d5db"
};

const TYPE_NAMES = {
  classroom: "교실",
  corridor: "복도",
  stairs: "계단",
  restroom: "화장실",
  entrance: "출입구",
  elevator: "엘리베이터",
  office: "교무실",
  other: "기타 장소"
};

const $ = id => document.getElementById(id);

const canvas = $("mapCanvas");
const buildingLayer = $("buildingLayer");
const connectionLayer = $("connectionLayer");
const placeLayer = $("placeLayer");

let currentTool = "select";
let selectedPlaceId = null;
let selectedConnectionId = null;
let pendingConnectionPlaceId = null;
let suppressNextClick = false;
let draggingPlaceId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let state;

/* ---------- 기본 데이터 ---------- */

function makeId() {
  return "id-" + Date.now().toString(36) +
    "-" + Math.random().toString(36).slice(2, 9);
}

function createFloor(name = "1층") {
  return {
    id: makeId(),
    name,
    places: [],
    connections: []
  };
}

function createInitialState() {
  return {
    version: 2,
    mapName: "우리 학교 지도",
    activeFloorId: null,
    floors: [createFloor("1층")]
  };
}

function getActiveFloor() {
  return state.floors.find(
    floor => floor.id === state.activeFloorId
  ) || state.floors[0];
}

function getPlace(id, floor = getActiveFloor()) {
  return floor.places.find(place => place.id === id);
}

function getConnection(id, floor = getActiveFloor()) {
  return floor.connections.find(connection => connection.id === id);
}

/* ---------- 저장 및 불러오기 ---------- */

function saveState(message = "변경 사항 자동 저장됨") {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus(message);
  } catch (error) {
    setStatus("저장 공간이 부족하거나 저장할 수 없습니다.");
    console.error(error);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();

    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error("저장 데이터 불러오기 실패:", error);
    return createInitialState();
  }
}

function normalizeState(data) {
  if (!data || !Array.isArray(data.floors) || !data.floors.length) {
    throw new Error("올바른 지도 파일이 아닙니다.");
  }

  const floors = data.floors.map((floor, index) => {
    const places = Array.isArray(floor.places) ? floor.places : [];
    const validPlaces = places.map(place => ({
      id: String(place.id || makeId()),
      name: String(place.name || "이름 없는 장소").slice(0, 60),
      type: COLORS[place.type] ? place.type : "other",
      x: clamp(snapToGrid(Number(place.x) || 200), 0, MAP_WIDTH),
      y: clamp(snapToGrid(Number(place.y) || 100), 0, MAP_HEIGHT),
      width: clamp(snapSize(Number(place.width) || 50), 25, 500),
      height: clamp(snapSize(Number(place.height) || 50), 25, 500),
      accessible: place.accessible === true,
      notes: String(place.notes || "").slice(0, 500)
    }));

    const placeIds = new Set(validPlaces.map(place => place.id));
    const connections = Array.isArray(floor.connections)
      ? floor.connections : [];

    const validConnections = connections
      .filter(connection =>
        placeIds.has(connection.from) &&
        placeIds.has(connection.to) &&
        connection.from !== connection.to
      )
      .map(connection => ({
        id: String(connection.id || makeId()),
        from: String(connection.from),
        to: String(connection.to),
        accessible: connection.accessible === true,
        verified: connection.verified === true,
        notes: String(connection.notes || "").slice(0, 500)
      }));

    return {
      id: String(floor.id || makeId()),
      name: String(floor.name || `${index + 1}층`).slice(0, 30),
      places: validPlaces,
      connections: validConnections
    };
  });

  const activeFloorId = floors.some(
    floor => floor.id === data.activeFloorId
  ) ? data.activeFloorId : floors[0].id;

  return {
    version: 2,
    mapName: String(data.mapName || "우리 학교 지도").slice(0, 80),
    activeFloorId,
    floors
  };
}

function setStatus(message) {
  $("status").textContent = message;
}

/* ---------- 격자 처리 ---------- */

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function snapSize(value) {
  return Math.max(GRID_SIZE, snapToGrid(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSvgPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: clamp(
      (event.clientX - rect.left) / rect.width * MAP_WIDTH,
      0,
      MAP_WIDTH
    ),
    y: clamp(
      (event.clientY - rect.top) / rect.height * MAP_HEIGHT,
      0,
      MAP_HEIGHT
    )
  };
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    tag
  );

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });

  return element;
}

/* ---------- 건물 기본 모양 ---------- */

function renderBuilding() {
  buildingLayer.replaceChildren();

  function addBuilding(x, y, width, height, title, color) {
    const group = createSvgElement("g");

    group.appendChild(createSvgElement("rect", {
      x, y, width, height,
      rx: 8,
      fill: color,
      stroke: "#94a3b8",
      "stroke-width": 2
    }));

    const label = createSvgElement("text", {
      x: x + width / 2,
      y: y + height / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-size": 24,
      "font-weight": 800,
      fill: "#334155",
      "pointer-events": "none"
    });

    label.textContent = title;
    group.appendChild(label);
    buildingLayer.appendChild(group);
  }

  // 위쪽 본관
  addBuilding(125, 50, 750, 150, "본관", "#eaf2ff");

  // 왼쪽 연결 건물
  addBuilding(125, 50, 150, 600, "연결 건물", "#eef2f7");

  // 아래쪽 후관
  addBuilding(125, 500, 750, 150, "후관", "#e9f8ef");

  // 중앙의 열린 공간
  const courtyard = createSvgElement("rect", {
    x: 285,
    y: 205,
    width: 580,
    height: 290,
    rx: 10,
    fill: "#f8fafc",
    stroke: "#d8e1eb",
    "stroke-dasharray": "7 7",
    "pointer-events": "none"
  });

  buildingLayer.appendChild(courtyard);

  const courtyardLabel = createSvgElement("text", {
    x: 575,
    y: 340,
    "text-anchor": "middle",
    "font-size": 23,
    "font-weight": 700,
    fill: "#94a3b8",
    "pointer-events": "none"
  });

  courtyardLabel.textContent = "중앙 열린 공간";
  buildingLayer.appendChild(courtyardLabel);

  const openingLabel = createSvgElement("text", {
    x: 930,
    y: 350,
    "text-anchor": "middle",
    "font-size": 18,
    "font-weight": 700,
    fill: "#64748b",
    "pointer-events": "none"
  });

  openingLabel.textContent = "개방";
  buildingLayer.appendChild(openingLabel);
}

/* ---------- 장소 표시 ---------- */

function renderPlaces() {
  placeLayer.replaceChildren();

  const floor = getActiveFloor();

  floor.places.forEach(place => {
    const selected = place.id === selectedPlaceId;
    const sizeWidth = place.width || 50;
    const sizeHeight = place.height || 50;
    const color = COLORS[place.type] || COLORS.other;

    const group = createSvgElement("g", {
      transform: `translate(${place.x}, ${place.y})`,
      "data-place-id": place.id
    });

    const rectangle = createSvgElement("rect", {
      x: -sizeWidth / 2,
      y: -sizeHeight / 2,
      width: sizeWidth,
      height: sizeHeight,
      rx: 5,
      fill: color,
      stroke: selected ? "#111827" : "#ffffff",
      "stroke-width": selected ? 4 : 2.5
    });

    group.appendChild(rectangle);

    if (place.accessible) {
      const mark = createSvgElement("text", {
        x: 0,
        y: 5,
        "text-anchor": "middle",
        "font-size": Math.min(20, sizeWidth / 2),
        "font-weight": "bold",
        fill: "#166534",
        "pointer-events": "none"
      });

      mark.textContent = "✓";
      group.appendChild(mark);
    }

    const label = createSvgElement("text", {
      x: 0,
      y: sizeHeight / 2 + 17,
      "text-anchor": "middle",
      "font-size": 14,
      "font-weight": selected ? 800 : 600,
      fill: "#172033",
      stroke: "#ffffff",
      "stroke-width": 3,
      "paint-order": "stroke",
      "pointer-events": "none"
    });

    label.textContent = place.name;
    group.appendChild(label);

    group.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;

      if (currentTool === "select") {
        const point = getSvgPoint(event);
        draggingPlaceId = place.id;
        dragOffsetX = point.x - place.x;
        dragOffsetY = point.y - place.y;

        selectedPlaceId = place.id;
        selectedConnectionId = null;
        renderEditors();
        renderPlaces();
        event.stopPropagation();
      }
    });

    group.addEventListener("click", event => {
      event.stopPropagation();

      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }

      handlePlaceClick(place.id);
    });

    placeLayer.appendChild(group);
  });
}

/* ---------- 복도·이동 경로 표시 ---------- */

function renderConnections() {
  connectionLayer.replaceChildren();

  const floor = getActiveFloor();

  floor.connections.forEach(connection => {
    const from = getPlace(connection.from, floor);
    const to = getPlace(connection.to, floor);

    if (!from || !to) return;

    const selected = connection.id === selectedConnectionId;

    const color = connection.accessible ? "#16a34a" : "#64748b";

    // 클릭하기 쉬운 투명한 선
    const hitLine = createSvgElement("line", {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: "transparent",
      "stroke-width": 18,
      "data-connection-id": connection.id
    });

    hitLine.addEventListener("click", event => {
      event.stopPropagation();
      selectConnection(connection.id);
    });

    connectionLayer.appendChild(hitLine);

    const line = createSvgElement("line", {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: selected ? "#2563eb" : color,
      "stroke-width": selected ? 7 : 4,
      "stroke-linecap": "round",
      "stroke-dasharray": connection.verified ? "none" : "9 6",
      "pointer-events": "none"
    });

    connectionLayer.appendChild(line);

    const midpoint = createSvgElement("circle", {
      cx: (from.x + to.x) / 2,
      cy: (from.y + to.y) / 2,
      r: selected ? 6 : 4,
      fill: selected ? "#2563eb" : color,
      stroke: "#ffffff",
      "stroke-width": 2,
      "pointer-events": "none"
    });

    connectionLayer.appendChild(midpoint);
  });
}

/* ---------- 선택한 장소 편집 ---------- */

function renderEditors() {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  $("placeFields").hidden = !place;
  $("placeEditor").querySelector(".empty-message").hidden = !!place;

  if (place) {
    $("placeName").value = place.name;
    $("placeType").value = place.type;
    $("placeWidth").value = place.width;
    $("placeHeight").value = place.height;
    $("placeAccessible").checked = place.accessible;
    $("placeNotes").value = place.notes;
  }

  const connection = selectedConnectionId
    ? getConnection(selectedConnectionId)
    : null;

  $("connectionFields").hidden = !connection;
  $("connectionEditor").querySelector(".empty-message").hidden =
    !!connection;

  if (connection) {
    const from = getPlace(connection.from);
    const to = getPlace(connection.to);

    $("connectionSummary").textContent =
      `${from?.name || "장소"} ↔ ${to?.name || "장소"}`;

    $("connectionAccessible").checked = connection.accessible;
    $("connectionVerified").checked = connection.verified;
    $("connectionNotes").value = connection.notes;
  }
}

/* ---------- 전체 화면 갱신 ---------- */

function renderFloorSelect() {
  const select = $("floorSelect");
  select.replaceChildren();

  state.floors.forEach(floor => {
    const option = document.createElement("option");
    option.value = floor.id;
    option.textContent = floor.name;
    select.appendChild(option);
  });

  select.value = state.activeFloorId;
}

function renderCounts() {
  const floor = getActiveFloor();
  $("placeCount").textContent = floor.places.length;
  $("connectionCount").textContent = floor.connections.length;

  $("workspaceTitle").textContent =
    `${state.mapName} · ${floor.name}`;
}

function renderAll() {
  $("mapName").value = state.mapName;
  renderFloorSelect();
  renderBuilding();
  renderConnections();
  renderPlaces();
  renderEditors();
  renderCounts();
}

function refreshMap() {
  renderConnections();
  renderPlaces();
  renderCounts();
}

/* ---------- 도구 선택 ---------- */

function setTool(tool) {
  currentTool = tool;
  pendingConnectionPlaceId = null;

  document.querySelectorAll("[data-tool]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.tool === tool
    );
  });

  const hints = {
    select: "장소를 선택하거나 드래그해서 이동하세요.",
    place: "지도에서 원하는 위치를 누르면 장소가 추가됩니다.",
    connect: "연결할 장소 두 개를 차례로 누르세요."
  };

  $("toolHint").textContent = hints[tool];
  $("canvasHint").textContent = hints[tool];
  canvas.style.cursor = tool === "place" ? "crosshair" : "default";
}

/* ---------- 장소 추가 ---------- */

function addPlace(x, y) {
  const floor = getActiveFloor();

  const place = {
    id: makeId(),
    name: `${TYPE_NAMES[$("placeType").value] || "장소"} ${floor.places.length + 1}`,
    type: $("placeType").value,
    x: clamp(snapToGrid(x), 25, MAP_WIDTH - 25),
    y: clamp(snapToGrid(y), 25, MAP_HEIGHT - 25),
    width: 50,
    height: 50,
    accessible: false,
    notes: ""
  };

  floor.places.push(place);
  selectedPlaceId = place.id;
  selectedConnectionId = null;

  setTool("select");
  renderAll();
  saveState("장소를 추가하고 자동 저장했습니다.");
}

/* ---------- 장소 선택 및 복도 연결 ---------- */

function handlePlaceClick(placeId) {
  if (currentTool === "connect") {
    if (!pendingConnectionPlaceId) {
      pendingConnectionPlaceId = placeId;
      selectedPlaceId = placeId;
      selectedConnectionId = null;
      $("canvasHint").textContent =
        "첫 번째 장소를 선택했어요. 이제 연결할 두 번째 장소를 누르세요.";
      renderAll();
      return;
    }

    if (pendingConnectionPlaceId === placeId) {
      pendingConnectionPlaceId = null;
      $("canvasHint").textContent =
        "같은 장소를 선택했어요. 다른 장소를 선택하세요.";
      return;
    }

    const floor = getActiveFloor();

    const exists = floor.connections.some(connection =>
      (connection.from === pendingConnectionPlaceId &&
        connection.to === placeId) ||
      (connection.from === placeId &&
        connection.to === pendingConnectionPlaceId)
    );

    if (exists) {
      setStatus("두 장소는 이미 연결되어 있습니다.");
      pendingConnectionPlaceId = null;
      return;
    }

    floor.connections.push({
      id: makeId(),
      from: pendingConnectionPlaceId,
      to: placeId,
      accessible: false,
      verified: false,
      notes: ""
    });

    selectedConnectionId = floor.connections.at(-1).id;
    selectedPlaceId = null;
    pendingConnectionPlaceId = null;

    setTool("select");
    renderAll();
    saveState("복도 연결을 추가했습니다.");
    return;
  }

  selectedPlaceId = placeId;
  selectedConnectionId = null;
  renderAll();
}

function selectConnection(id) {
  selectedConnectionId = id;
  selectedPlaceId = null;
  renderAll();
}

/* ---------- 지도 클릭 ---------- */

canvas.addEventListener("click", event => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  // 장소나 복도 선을 누른 경우는 각 요소에서 처리
  if (event.target.closest("[data-place-id]") ||
      event.target.closest("[data-connection-id]")) {
    return;
  }

  if (currentTool === "place") {
    const point = getSvgPoint(event);
    addPlace(point.x, point.y);
  } else {
    selectedPlaceId = null;
    selectedConnectionId = null;
    pendingConnectionPlaceId = null;
    renderAll();
  }
});

/* ---------- 장소 드래그 ---------- */

canvas.addEventListener("pointermove", event => {
  if (!draggingPlaceId) return;

  const floor = getActiveFloor();
  const place = getPlace(draggingPlaceId, floor);
  if (!place) return;

  const point = getSvgPoint(event);

  place.x = clamp(
    snapToGrid(point.x - dragOffsetX),
    25,
    MAP_WIDTH - 25
  );

  place.y = clamp(
    snapToGrid(point.y - dragOffsetY),
    25,
    MAP_HEIGHT - 25
  );

  suppressNextClick = true;
  refreshMap();
});

function stopDragging() {
  if (!draggingPlaceId) return;

  draggingPlaceId = null;
  saveState("장소 위치를 저장했습니다.");

  // 드래그 직후 클릭이 추가 동작을 일으키지 않도록 유지
  setTimeout(() => {
    suppressNextClick = false;
  }, 0);
}

canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
window.addEventListener("pointerup", stopDragging);

/* ---------- 장소 편집 이벤트 ---------- */

$("mapName").addEventListener("input", event => {
  state.mapName = event.target.value.slice(0, 80);
  $("workspaceTitle").textContent =
    `${state.mapName} · ${getActiveFloor().name}`;
  saveState();
});

$("placeName").addEventListener("input", event => {
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) return;

  place.name = event.target.value.slice(0, 60);
  refreshMap();
  saveState();
});

$("placeType").addEventListener("change", event => {
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) return;

  place.type = event.target.value;
  refreshMap();
  saveState("장소 종류를 변경했습니다.");
});

$("placeAccessible").addEventListener("change", event => {
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) return;

  place.accessible = event.target.checked;
  refreshMap();
  saveState();
});

$("placeNotes").addEventListener("input", event => {
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) return;

  place.notes = event.target.value.slice(0, 500);
  saveState();
});

$("applySizeBtn").addEventListener("click", () => {
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) {
    setStatus("먼저 크기를 변경할 장소를 선택하세요.");
    return;
  }

  const width = Number($("placeWidth").value);
  const height = Number($("placeHeight").value);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    setStatus("가로와 세로 크기를 숫자로 입력하세요.");
    return;
  }

  place.width = clamp(snapSize(width), 25, 500);
  place.height = clamp(snapSize(height), 25, 500);

  $("placeWidth").value = place.width;
  $("placeHeight").value = place.height;

  refreshMap();
  saveState("장소 크기를 적용했습니다.");
});

$("deletePlaceBtn").addEventListener("click", () => {
  const floor = getActiveFloor();
  const place = selectedPlaceId && getPlace(selectedPlaceId);
  if (!place) return;

  if (!confirm(`"${place.name}" 장소를 삭제할까요?\n연결된 복도도 삭제됩니다.`)) {
    return;
  }

  floor.places = floor.places.filter(item => item.id !== place.id);
  floor.connections = floor.connections.filter(
    connection =>
      connection.from !== place.id &&
      connection.to !== place.id
  );

  selectedPlaceId = null;
  selectedConnectionId = null;
  renderAll();
  saveState("장소와 연결된 복도를 삭제했습니다.");
});

/* ---------- 복도 편집 이벤트 ---------- */

$("connectionAccessible").addEventListener("change", event => {
  const connection = selectedConnectionId &&
    getConnection(selectedConnectionId);
  if (!connection) return;

  connection.accessible = event.target.checked;
  refreshMap();
  saveState("접근 가능 여부를 변경했습니다.");
});

$("connectionVerified").addEventListener("change", event => {
  const connection = selectedConnectionId &&
    getConnection(selectedConnectionId);
  if (!connection) return;

  connection.verified = event.target.checked;
  refreshMap();
  saveState("경로 확인 상태를 변경했습니다.");
});

$("connectionNotes").addEventListener("input", event => {
  const connection = selectedConnectionId &&
    getConnection(selectedConnectionId);
  if (!connection) return;

  connection.notes = event.target.value.slice(0, 500);
  saveState();
});

$("deleteConnectionBtn").addEventListener("click", () => {
  const floor = getActiveFloor();
  const connection = selectedConnectionId &&
    getConnection(selectedConnectionId);

  if (!connection) return;

  if (!confirm("이 복도 연결을 삭제할까요?")) return;

  floor.connections = floor.connections.filter(
    item => item.id !== connection.id
  );

  selectedConnectionId = null;
  renderAll();
  saveState("복도 연결을 삭제했습니다.");
});

/* ---------- 층 관리 ---------- */

$("floorSelect").addEventListener("change", event => {
  state.activeFloorId = event.target.value;
  selectedPlaceId = null;
  selectedConnectionId = null;
  pendingConnectionPlaceId = null;
  renderAll();
  saveState("작업 층을 변경했습니다.");
});

$("addFloorBtn").addEventListener("click", () => {
  const suggested = `${state.floors.length + 1}층`;
  const name = prompt("새 층 이름을 입력하세요.", suggested);

  if (name === null) return;

  const cleanName = name.trim().slice(0, 30);
  if (!cleanName) {
    setStatus("층 이름을 입력하세요.");
    return;
  }

  const floor = createFloor(cleanName);
  state.floors.push(floor);
  state.activeFloorId = floor.id;

  selectedPlaceId = null;
  selectedConnectionId = null;
  renderAll();
  saveState("새 층을 추가했습니다.");
});

/* ---------- 도구 버튼 ---------- */

document.querySelectorAll("[data-tool]").forEach(button => {
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  });
});

/* ---------- JSON 내보내기 ---------- */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name) {
  return (name || "gilbeot-map")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "gilbeot-map";
}

function exportJson() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], {
    type: "application/json;charset=utf-8"
  });

  downloadBlob(blob, `${safeFilename(state.mapName)}.json`);
  setStatus("JSON 파일을 내보냈습니다.");
}

$("downloadJsonBtn").addEventListener("click", exportJson);

$("copyJsonBtn").addEventListener("click", () => {
  const preview = $("jsonPreview");
  preview.hidden = false;
  preview.value = JSON.stringify(state, null, 2);
  preview.focus();
  preview.select();
  setStatus("JSON 미리보기를 표시했습니다.");

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(preview.value)
      .then(() => setStatus("JSON을 클립보드에 복사했습니다."))
      .catch(() => setStatus("미리보기에서 JSON을 직접 복사하세요."));
  }
});

/* ---------- JSON 가져오기 ---------- */

$("importButton").addEventListener("click", () => {
  $("importJsonInput").click();
});

$("importJsonInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("10MB 이하의 JSON 파일만 가져올 수 있습니다.");
    }

    const text = await file.text();
    const imported = normalizeState(JSON.parse(text));

    if (!confirm("현재 지도를 가져온 파일로 교체할까요?")) {
      return;
    }

    state = imported;
    selectedPlaceId = null;
    selectedConnectionId = null;
    pendingConnectionPlaceId = null;

    renderAll();
    saveState("JSON 파일을 가져왔습니다.");
  } catch (error) {
    alert("파일을 가져오지 못했습니다.\n" + error.message);
  } finally {
    event.target.value = "";
  }
});

/* ---------- PNG 이미지 저장 ---------- */

async function exportPng() {
  try {
    const clone = canvas.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", MAP_WIDTH);
    clone.setAttribute("height", MAP_HEIGHT);

    const svgText = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgText], {
      type: "image/svg+xml;charset=utf-8"
    });

    const url = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      try {
        const output = document.createElement("canvas");
        output.width = MAP_WIDTH * 2;
        output.height = MAP_HEIGHT * 2;

        const context = output.getContext("2d");
        context.scale(2, 2);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
        context.drawImage(image, 0, 0, MAP_WIDTH, MAP_HEIGHT);

        output.toBlob(blob => {
          URL.revokeObjectURL(url);

          if (!blob) {
            setStatus("PNG 파일을 만들지 못했습니다.");
            return;
          }

          downloadBlob(
            blob,
            `${safeFilename(state.mapName)}-${safeFilename(getActiveFloor().name)}.png`
          );

          setStatus("PNG 이미지를 저장했습니다.");
        }, "image/png");
      } catch (error) {
        URL.revokeObjectURL(url);
        setStatus("PNG 변환에 실패했습니다.");
        console.error(error);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("지도 이미지를 불러오지 못했습니다.");
    };

    image.src = url;
  } catch (error) {
    setStatus("PNG 내보내기에 실패했습니다.");
    console.error(error);
  }
}

$("exportPngBtn").addEventListener("click", exportPng);

/* ---------- 새 지도 만들기 ---------- */

$("newMapBtn").addEventListener("click", () => {
  if (!confirm("현재 지도를 초기화하고 새 지도를 만들까요?\n중요한 지도는 먼저 JSON으로 내보내세요.")) {
    return;
  }

  state = createInitialState();
  state.activeFloorId = state.floors[0].id;

  selectedPlaceId = null;
  selectedConnectionId = null;
  pendingConnectionPlaceId = null;

  renderAll();
  saveState("새 지도를 만들었습니다.");
});

/* ---------- 앱 시작 ---------- */

state = loadState();

if (!state.activeFloorId || !getActiveFloor()) {
  state.activeFloorId = state.floors[0].id;
}

renderAll();
setTool("select");
saveState("지도가 준비되었습니다.");

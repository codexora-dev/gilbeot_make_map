"use strict";

const GRID_SIZE = 25;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;
const STORAGE_KEY = "gilbeot-map-data-v3";

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
const routeLayer = $("routeLayer");
const placeLayer = $("placeLayer");
const draftLayer = $("draftLayer");

let state;
let currentTool = "select";
let selectedPlaceId = null;
let selectedRouteId = null;
let draftPoints = [];

let draggingPlaceId = null;
let draggingRouteId = null;
let draggingRoutePointIndex = -1;

let dragStartPlaceX = 0;
let dragStartPlaceY = 0;
let dragStartPointerX = 0;
let dragStartPointerY = 0;

let suppressNextClick = false;
let pointerMoved = false;

/* =========================
   기본 유틸리티
========================= */

function makeId() {
  return "id-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 9);
}

function createFloor(name = "1층") {
  return {
    id: makeId(),
    name,
    places: [],
    routes: []
  };
}

function createInitialState() {
  const floor = createFloor("1층");

  return {
    version: 3,
    mapName: "우리 학교 지도",
    activeFloorId: floor.id,
    floors: [floor]
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

function getRoute(id, floor = getActiveFloor()) {
  return floor.routes.find(route => route.id === id);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function snapSize(value) {
  return Math.max(
    25,
    Math.round(value / GRID_SIZE) * GRID_SIZE
  );
}

function setStatus(message) {
  $("status").textContent = message;
}

function saveState(message = "변경 사항을 자동 저장했습니다.") {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state)
    );

    setStatus(message);
  } catch (error) {
    console.error(error);

    setStatus(
      "브라우저 저장 공간에 저장하지 못했습니다. JSON으로 백업해 주세요."
    );
  }
}

/* =========================
   데이터 정규화 및 불러오기
========================= */

function normalizeState(data) {
  if (
    !data ||
    !Array.isArray(data.floors) ||
    !data.floors.length
  ) {
    throw new Error("올바른 지도 파일이 아닙니다.");
  }

  const floors = data.floors.map((floor, index) => {
    const places = (
      Array.isArray(floor.places) ? floor.places : []
    ).map(place => {
      const width = clamp(
        snapSize(Number(place.width) || 50),
        25,
        500
      );

      const height = clamp(
        snapSize(Number(place.height) || 50),
        25,
        500
      );

      return {
        id: String(place.id || makeId()),

        name: String(
          place.name || "이름 없는 장소"
        ).slice(0, 60),

        type: COLORS[place.type]
          ? place.type
          : "other",

        x: clamp(
          snapToGrid(Number(place.x) || 200),
          25,
          MAP_WIDTH - width / 2
        ),

        y: clamp(
          snapToGrid(Number(place.y) || 100),
          25,
          MAP_HEIGHT - height / 2
        ),

        width,
        height,

        accessible: place.accessible === true,

        notes: String(
          place.notes || ""
        ).slice(0, 500)
      };
    });

    const routes = (
      Array.isArray(floor.routes) ? floor.routes : []
    ).map(route => ({
      id: String(route.id || makeId()),

      name: String(
        route.name || "이동 경로"
      ).slice(0, 60),

      points: Array.isArray(route.points)
        ? route.points
            .filter(point =>
              Number.isFinite(Number(point.x)) &&
              Number.isFinite(Number(point.y))
            )
            .map(point => ({
              x: clamp(
                snapToGrid(Number(point.x)),
                0,
                MAP_WIDTH
              ),

              y: clamp(
                snapToGrid(Number(point.y)),
                0,
                MAP_HEIGHT
              )
            }))
        : [],

      accessible: route.accessible === true,
      verified: route.verified === true,

      notes: String(
        route.notes || ""
      ).slice(0, 500)
    })).filter(route => route.points.length >= 2);

    return {
      id: String(floor.id || makeId()),

      name: String(
        floor.name || `${index + 1}층`
      ).slice(0, 30),

      places,
      routes
    };
  });

  const activeFloorId = floors.some(
    floor => floor.id === data.activeFloorId
  )
    ? data.activeFloorId
    : floors[0].id;

  return {
    version: 3,

    mapName: String(
      data.mapName || "우리 학교 지도"
    ).slice(0, 80),

    activeFloorId,
    floors
  };
}

function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("gilbeot-map-data-v2");

    if (!raw) {
      return createInitialState();
    }

    const data = JSON.parse(raw);

    if (data && Array.isArray(data.floors)) {
      data.floors = data.floors.map(floor => ({
        ...floor,

        routes: Array.isArray(floor.routes)
          ? floor.routes
          : []
      }));
    }

    return normalizeState(data);
  } catch (error) {
    console.error(
      "저장 데이터 불러오기 실패:",
      error
    );

    return createInitialState();
  }
}

/* =========================
   SVG 처리
========================= */

function getSvgPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: clamp(
      (event.clientX - rect.left) /
        rect.width * MAP_WIDTH,
      0,
      MAP_WIDTH
    ),

    y: clamp(
      (event.clientY - rect.top) /
        rect.height * MAP_HEIGHT,
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

/* =========================
   학교 건물 배치도
========================= */

function renderBuilding() {
  buildingLayer.replaceChildren();

  function addBuilding(
    x,
    y,
    width,
    height,
    title,
    color
  ) {
    const group = createSvgElement("g");

    group.appendChild(
      createSvgElement("rect", {
        x,
        y,
        width,
        height,
        rx: 8,
        fill: color,
        stroke: "#94a3b8",
        "stroke-width": 2
      })
    );

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

  /*
   * 좌우 반전된 ㄷ자형 배치도
   *
   * 본관: 위쪽
   * 후관: 아래쪽
   * 연결 건물: 오른쪽
   * 개방 방향: 왼쪽
   *
   * 건물 배경은 지도 안내용이며
   * 실제 장소와 이동 경로는 별도로 편집합니다.
   */

  addBuilding(
    125, 50, 750, 150,
    "본관",
    "#eaf2ff"
  );

  addBuilding(
    725, 50, 150, 600,
    "연결 건물",
    "#eef2f7"
  );

  addBuilding(
    125, 500, 750, 150,
    "후관",
    "#e9f8ef"
  );

  buildingLayer.appendChild(
    createSvgElement("rect", {
      x: 135,
      y: 205,
      width: 580,
      height: 290,
      rx: 10,
      fill: "#f8fafc",
      stroke: "#d8e1eb",
      "stroke-dasharray": "7 7",
      "pointer-events": "none"
    })
  );

  const courtyardLabel = createSvgElement(
    "text",
    {
      x: 425,
      y: 350,
      "text-anchor": "middle",
      "font-size": 23,
      "font-weight": 700,
      fill: "#94a3b8",
      "pointer-events": "none"
    }
  );

  courtyardLabel.textContent = "중앙 열린 공간";

  buildingLayer.appendChild(courtyardLabel);

  const openingLabel = createSvgElement(
    "text",
    {
      x: 70,
      y: 350,
      "text-anchor": "middle",
      "font-size": 18,
      "font-weight": 700,
      fill: "#64748b",
      "pointer-events": "none"
    }
  );

  openingLabel.textContent = "개방";

  buildingLayer.appendChild(openingLabel);
}

/* =========================
   장소 렌더링
========================= */

function renderPlaces() {
  placeLayer.replaceChildren();

  const floor = getActiveFloor();

  floor.places.forEach(place => {
    const selected = place.id === selectedPlaceId;

    const width = place.width || 50;
    const height = place.height || 50;

    const group = createSvgElement("g", {
      transform: `translate(${place.x}, ${place.y})`,
      "data-place-id": place.id
    });

    group.appendChild(
      createSvgElement("rect", {
        x: -width / 2,
        y: -height / 2,
        width,
        height,
        rx: 5,
        fill: COLORS[place.type] || COLORS.other,
        stroke: selected ? "#111827" : "#ffffff",
        "stroke-width": selected ? 4 : 2.5
      })
    );

    if (place.accessible) {
      const mark = createSvgElement("text", {
        x: 0,
        y: 5,
        "text-anchor": "middle",
        "font-size": Math.min(20, width / 2),
        "font-weight": "bold",
        fill: "#166534",
        "pointer-events": "none"
      });

      mark.textContent = "✓";
      group.appendChild(mark);
    }

    const label = createSvgElement("text", {
      x: 0,
      y: height / 2 + 17,
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
      if (
        event.button !== 0 ||
        currentTool !== "select"
      ) {
        return;
      }

      const point = getSvgPoint(event);

      draggingPlaceId = place.id;

      dragStartPlaceX = place.x;
      dragStartPlaceY = place.y;

      dragStartPointerX = point.x;
      dragStartPointerY = point.y;

      pointerMoved = false;

      selectedPlaceId = place.id;
      selectedRouteId = null;

      renderEditors();
      renderPlaces();

      event.stopPropagation();
    });

    group.addEventListener("click", event => {
      event.stopPropagation();

      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }

      if (currentTool === "route") {
        addRoutePointAtPlace(place);
        return;
      }

      selectedPlaceId = place.id;
      selectedRouteId = null;

      renderAll();
    });

    placeLayer.appendChild(group);
  });
}

/* =========================
   이동 경로 렌더링
========================= */

function pointsToString(points) {
  return points
    .map(point => `${point.x},${point.y}`)
    .join(" ");
}

function renderRoutes() {
  routeLayer.replaceChildren();

  const floor = getActiveFloor();

  floor.routes.forEach(route => {
    const selected = route.id === selectedRouteId;

    const stroke = route.accessible
      ? "#16a34a"
      : "#64748b";

    const points = pointsToString(route.points);

    const hitLine = createSvgElement("polyline", {
      points,
      fill: "none",
      stroke: "transparent",
      "stroke-width": 20,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "data-route-id": route.id
    });

    hitLine.addEventListener("click", event => {
      event.stopPropagation();

      if (currentTool === "route") {
        return;
      }

      selectedRouteId = route.id;
      selectedPlaceId = null;

      renderAll();
    });

    routeLayer.appendChild(hitLine);

    routeLayer.appendChild(
      createSvgElement("polyline", {
        points,
        fill: "none",
        stroke: selected ? "#2563eb" : stroke,
        "stroke-width": selected ? 8 : 5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-dasharray": route.verified
          ? "none"
          : "10 7",
        "pointer-events": "none"
      })
    );

    route.points.forEach((point, index) => {
      const handle = createSvgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: selected ? 7 : 3.5,
        fill: selected ? "#2563eb" : stroke,
        stroke: "#ffffff",
        "stroke-width": 2,
        "pointer-events": selected ? "all" : "none",
        cursor: selected ? "move" : "default"
      });

      if (selected) {
        handle.addEventListener(
          "pointerdown",
          event => {
            if (
              event.button !== 0 ||
              currentTool !== "select"
            ) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            draggingRouteId = route.id;
            draggingRoutePointIndex = index;

            pointerMoved = false;

            try {
              canvas.setPointerCapture(
                event.pointerId
              );
            } catch (error) {
              // 포인터 캡처를 지원하지 않아도 동작합니다.
            }
          }
        );
      }

      routeLayer.appendChild(handle);

      if (selected && index === 0) {
        const start = createSvgElement("text", {
          x: point.x + 8,
          y: point.y - 8,
          "font-size": 12,
          "font-weight": 800,
          fill: "#1d4ed8",
          "pointer-events": "none"
        });

        start.textContent = "시작";

        routeLayer.appendChild(start);
      }
    });
  });
}

/* =========================
   경로 작성 미리보기
========================= */

function renderDraft() {
  draftLayer.replaceChildren();

  if (draftPoints.length === 0) {
    return;
  }

  if (draftPoints.length >= 2) {
    draftLayer.appendChild(
      createSvgElement("polyline", {
        points: pointsToString(draftPoints),
        fill: "none",
        stroke: "#2563eb",
        "stroke-width": 5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-dasharray": "9 6",
        "pointer-events": "none"
      })
    );
  }

  draftPoints.forEach((point, index) => {
    draftLayer.appendChild(
      createSvgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 7,
        fill: index === 0
          ? "#16a34a"
          : "#2563eb",
        stroke: "#ffffff",
        "stroke-width": 2,
        "pointer-events": "none"
      })
    );
  });
}

/* =========================
   편집기 UI 렌더링
========================= */

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

function renderEditors() {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  $("placeFields").hidden = !place;

  $("placeEditor").querySelector(
    ".empty-message"
  ).hidden = !!place;

  if (place) {
    $("placeName").value = place.name;
    $("placeType").value = place.type;
    $("placeWidth").value = place.width;
    $("placeHeight").value = place.height;
    $("placeAccessible").checked = place.accessible;
    $("placeNotes").value = place.notes;
  }

  const route = selectedRouteId
    ? getRoute(selectedRouteId)
    : null;

  $("routeFields").hidden = !route;

  $("routeEditor").querySelector(
    ".empty-message"
  ).hidden = !!route;

  if (route) {
    $("routeName").value = route.name;
    $("routeAccessible").checked = route.accessible;
    $("routeVerified").checked = route.verified;
    $("routeNotes").value = route.notes;
  }
}

function renderCounts() {
  const floor = getActiveFloor();

  $("placeCount").textContent = floor.places.length;
  $("routeCount").textContent = floor.routes.length;

  $("workspaceTitle").textContent =
    `${state.mapName} · ${floor.name}`;
}

function renderAll() {
  $("mapName").value = state.mapName;

  renderFloorSelect();
  renderBuilding();
  renderRoutes();
  renderPlaces();
  renderDraft();
  renderEditors();
  renderCounts();
}

function refreshMap() {
  renderRoutes();
  renderPlaces();
  renderDraft();
  renderCounts();
}

/* =========================
   도구 선택
========================= */

function setTool(tool) {
  currentTool = tool;

  if (tool !== "route") {
    draftPoints = [];
  }

  document.querySelectorAll("[data-tool]").forEach(button => {
    const active = button.dataset.tool === tool;

    button.classList.toggle("active", active);

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });

  const hints = {
    select:
      "장소나 경로를 선택하세요. 장소는 드래그해서 이동할 수 있어요.",

    place:
      "지도에서 원하는 위치를 누르면 장소가 추가됩니다.",

    route:
      "지도에서 시작점과 꺾이는 지점을 차례로 눌러 경로를 그리세요."
  };

  $("toolHint").textContent = hints[tool];
  $("canvasHint").textContent = hints[tool];

  $("routeActions").hidden = tool !== "route";

  canvas.style.cursor =
    tool === "place" || tool === "route"
      ? "crosshair"
      : "default";

  renderDraft();
}

/* =========================
   장소 추가
========================= */

function addPlace(x, y) {
  const floor = getActiveFloor();

  const type = $("placeType").value || "classroom";

  const place = {
    id: makeId(),

    name: `${
      TYPE_NAMES[type] || "장소"
    } ${floor.places.length + 1}`,

    type,

    x: clamp(
      snapToGrid(x),
      25,
      MAP_WIDTH - 25
    ),

    y: clamp(
      snapToGrid(y),
      25,
      MAP_HEIGHT - 25
    ),

    width: 50,
    height: 50,

    accessible: false,
    notes: ""
  };

  floor.places.push(place);

  selectedPlaceId = place.id;
  selectedRouteId = null;

  setTool("select");

  renderAll();

  saveState(
    "장소를 추가하고 자동 저장했습니다."
  );
}

/* =========================
   이동 경로 작성
========================= */

function addRoutePoint(point) {
  const snapped = {
    x: clamp(
      snapToGrid(point.x),
      0,
      MAP_WIDTH
    ),

    y: clamp(
      snapToGrid(point.y),
      0,
      MAP_HEIGHT
    )
  };

  const last = draftPoints[draftPoints.length - 1];

  if (
    last &&
    last.x === snapped.x &&
    last.y === snapped.y
  ) {
    return;
  }

  draftPoints.push(snapped);

  $("canvasHint").textContent =
    `경로에 ${draftPoints.length}개 지점을 추가했어요. ` +
    "더블클릭하거나 ‘경로 완성’을 누르세요.";

  renderDraft();
}

function addRoutePointAtPlace(place) {
  addRoutePoint({
    x: place.x,
    y: place.y
  });
}

function finishRoute() {
  if (draftPoints.length < 2) {
    setStatus(
      "경로를 완성하려면 서로 다른 지점이 2개 이상 필요합니다."
    );

    return;
  }

  const floor = getActiveFloor();

  const route = {
    id: makeId(),

    name: `이동 경로 ${floor.routes.length + 1}`,

    points: draftPoints.map(point => ({
      ...point
    })),

    accessible: false,
    verified: false,
    notes: ""
  };

  floor.routes.push(route);

  draftPoints = [];

  selectedRouteId = route.id;
  selectedPlaceId = null;

  setTool("select");

  renderAll();

  saveState("이동 경로를 추가했습니다.");
}

function cancelRoute() {
  draftPoints = [];

  renderDraft();

  setStatus("경로 그리기를 취소했습니다.");
}

/* =========================
   삭제 기능
========================= */

function deleteSelectedPlace() {
  const floor = getActiveFloor();

  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  if (!place) {
    return;
  }

  if (
    !confirm(
      `"${place.name}" 장소를 삭제할까요?`
    )
  ) {
    return;
  }

  floor.places = floor.places.filter(
    item => item.id !== place.id
  );

  selectedPlaceId = null;

  renderAll();

  saveState("장소를 삭제했습니다.");
}

function deleteSelectedRoute() {
  const floor = getActiveFloor();

  const route = selectedRouteId
    ? getRoute(selectedRouteId)
    : null;

  if (!route) {
    return;
  }

  if (
    !confirm(
      `"${route.name}" 경로를 삭제할까요?`
    )
  ) {
    return;
  }

  floor.routes = floor.routes.filter(
    item => item.id !== route.id
  );

  selectedRouteId = null;

  renderAll();

  saveState("이동 경로를 삭제했습니다.");
}

/* =========================
   지도 클릭 이벤트
========================= */

canvas.addEventListener("click", event => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  if (
    event.target.closest("[data-place-id]") ||
    event.target.closest("[data-route-id]")
  ) {
    return;
  }

  const point = getSvgPoint(event);

  if (currentTool === "place") {
    addPlace(point.x, point.y);
  } else if (currentTool === "route") {
    addRoutePoint(point);
  } else {
    selectedPlaceId = null;
    selectedRouteId = null;

    renderAll();
  }
});

canvas.addEventListener("dblclick", event => {
  if (currentTool !== "route") {
    return;
  }

  event.preventDefault();

  finishRoute();
});

/* =========================
   드래그 이동
========================= */

canvas.addEventListener("pointermove", event => {
  const point = getSvgPoint(event);

  // 경로의 개별 지점 이동
  if (draggingRouteId) {
    const floor = getActiveFloor();

    const route = getRoute(
      draggingRouteId,
      floor
    );

    if (
      !route ||
      !route.points[draggingRoutePointIndex]
    ) {
      return;
    }

    const snappedX = clamp(
      snapToGrid(point.x),
      0,
      MAP_WIDTH
    );

    const snappedY = clamp(
      snapToGrid(point.y),
      0,
      MAP_HEIGHT
    );

    const routePoint =
      route.points[draggingRoutePointIndex];

    if (
      routePoint.x !== snappedX ||
      routePoint.y !== snappedY
    ) {
      routePoint.x = snappedX;
      routePoint.y = snappedY;

      pointerMoved = true;

      refreshMap();
    }

    return;
  }

  // 장소 이동
  if (!draggingPlaceId) {
    return;
  }

  const floor = getActiveFloor();

  const place = getPlace(
    draggingPlaceId,
    floor
  );

  if (!place) {
    return;
  }

  const dx = snapToGrid(
    point.x - dragStartPointerX
  );

  const dy = snapToGrid(
    point.y - dragStartPointerY
  );

  if (dx !== 0 || dy !== 0) {
    pointerMoved = true;
  }

  place.x = clamp(
    snapToGrid(dragStartPlaceX + dx),
    place.width / 2,
    MAP_WIDTH - place.width / 2
  );

  place.y = clamp(
    snapToGrid(dragStartPlaceY + dy),
    place.height / 2,
    MAP_HEIGHT - place.height / 2
  );

  suppressNextClick = pointerMoved;

  refreshMap();
});

function stopDragging() {
  const movedRoute = !!draggingRouteId;
  const movedPlace = !!draggingPlaceId;

  const didMove = pointerMoved;

  draggingRouteId = null;
  draggingRoutePointIndex = -1;
  draggingPlaceId = null;

  if (didMove && movedRoute) {
    saveState(
      "이동 경로를 수정하고 저장했습니다."
    );
  } else if (didMove && movedPlace) {
    saveState("장소 위치를 저장했습니다.");
  }

  setTimeout(() => {
    suppressNextClick = false;
    pointerMoved = false;
  }, 0);
}

canvas.addEventListener(
  "pointerup",
  stopDragging
);

canvas.addEventListener(
  "pointercancel",
  stopDragging
);

window.addEventListener(
  "pointerup",
  stopDragging
);

/* =========================
   지도 이름
========================= */

$("mapName").addEventListener("input", event => {
  state.mapName = event.target.value.slice(0, 80);

  $("workspaceTitle").textContent =
    `${state.mapName} · ${getActiveFloor().name}`;

  saveState();
});

/* =========================
   층 관리
========================= */

$("floorSelect").addEventListener("change", event => {
  state.activeFloorId = event.target.value;

  selectedPlaceId = null;
  selectedRouteId = null;
  draftPoints = [];

  renderAll();

  saveState("작업 층을 변경했습니다.");
});

$("addFloorBtn").addEventListener("click", () => {
  const name = prompt(
    "새 층 이름을 입력하세요.",
    `${state.floors.length + 1}층`
  );

  if (name === null) {
    return;
  }

  const cleanName = name.trim().slice(0, 30);

  if (!cleanName) {
    setStatus("층 이름을 입력하세요.");
    return;
  }

  const floor = createFloor(cleanName);

  state.floors.push(floor);
  state.activeFloorId = floor.id;

  selectedPlaceId = null;
  selectedRouteId = null;
  draftPoints = [];

  renderAll();

  saveState("새 층을 추가했습니다.");
});

/* =========================
   도구 버튼
========================= */

document.querySelectorAll("[data-tool]").forEach(button => {
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  });
});

$("finishRouteBtn").addEventListener(
  "click",
  finishRoute
);

$("cancelRouteBtn").addEventListener(
  "click",
  cancelRoute
);

/* =========================
   장소 속성 편집
========================= */

$("placeName").addEventListener("input", event => {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  if (!place) {
    return;
  }

  place.name = event.target.value.slice(0, 60);

  refreshMap();
  saveState();
});

$("placeType").addEventListener("change", event => {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  if (!place) {
    return;
  }

  place.type = event.target.value;

  refreshMap();

  saveState("장소 종류를 변경했습니다.");
});

$("placeAccessible").addEventListener(
  "change",
  event => {
    const place = selectedPlaceId
      ? getPlace(selectedPlaceId)
      : null;

    if (!place) {
      return;
    }

    place.accessible = event.target.checked;

    refreshMap();
    saveState();
  }
);

$("placeNotes").addEventListener("input", event => {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  if (!place) {
    return;
  }

  place.notes = event.target.value.slice(0, 500);

  saveState();
});

/* =========================
   장소 크기 변경
========================= */

$("applySizeBtn").addEventListener("click", () => {
  const place = selectedPlaceId
    ? getPlace(selectedPlaceId)
    : null;

  if (!place) {
    setStatus(
      "먼저 크기를 변경할 장소를 선택하세요."
    );

    return;
  }

  const width = Number($("placeWidth").value);
  const height = Number($("placeHeight").value);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    setStatus(
      "가로와 세로 크기를 숫자로 입력하세요."
    );

    return;
  }

  place.width = clamp(
    snapSize(width),
    25,
    500
  );

  place.height = clamp(
    snapSize(height),
    25,
    500
  );

  place.x = clamp(
    snapToGrid(place.x),
    place.width / 2,
    MAP_WIDTH - place.width / 2
  );

  place.y = clamp(
    snapToGrid(place.y),
    place.height / 2,
    MAP_HEIGHT - place.height / 2
  );

  $("placeWidth").value = place.width;
  $("placeHeight").value = place.height;

  refreshMap();

  saveState("장소 크기를 적용했습니다.");
});

$("deletePlaceBtn").addEventListener(
  "click",
  deleteSelectedPlace
);

/* =========================
   이동 경로 속성 편집
========================= */

$("routeName").addEventListener("input", event => {
  const route = selectedRouteId
    ? getRoute(selectedRouteId)
    : null;

  if (!route) {
    return;
  }

  route.name = event.target.value.slice(0, 60);

  saveState();
});

$("routeAccessible").addEventListener(
  "change",
  event => {
    const route = selectedRouteId
      ? getRoute(selectedRouteId)
      : null;

    if (!route) {
      return;
    }

    route.accessible = event.target.checked;

    refreshMap();

    saveState(
      "경로 접근성 설정을 변경했습니다."
    );
  }
);

$("routeVerified").addEventListener(
  "change",
  event => {
    const route = selectedRouteId
      ? getRoute(selectedRouteId)
      : null;

    if (!route) {
      return;
    }

    route.verified = event.target.checked;

    refreshMap();

    saveState(
      "현장 확인 상태를 변경했습니다."
    );
  }
);

$("routeNotes").addEventListener("input", event => {
  const route = selectedRouteId
    ? getRoute(selectedRouteId)
    : null;

  if (!route) {
    return;
  }

  route.notes = event.target.value.slice(0, 500);

  saveState();
});

$("deleteRouteBtn").addEventListener(
  "click",
  deleteSelectedRoute
);

/* =========================
   JSON 내보내기 및 가져오기
========================= */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function safeFilename(name) {
  return (
    name || "gilbeot-map"
  ).replace(/[\\/:*?"<>|]/g, "_").trim() ||
    "gilbeot-map";
}

function exportJson() {
  const blob = new Blob(
    [JSON.stringify(state, null, 2)],
    {
      type: "application/json;charset=utf-8"
    }
  );

  downloadBlob(
    blob,
    `${safeFilename(state.mapName)}.json`
  );

  setStatus("JSON 파일을 내보냈습니다.");
}

$("downloadJsonBtn").addEventListener(
  "click",
  exportJson
);

$("copyJsonBtn").addEventListener(
  "click",
  async () => {
    const preview = $("jsonPreview");

    preview.hidden = false;
    preview.value = JSON.stringify(state, null, 2);

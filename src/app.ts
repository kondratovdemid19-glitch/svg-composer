import {
  readAsset,
  composeSvg,
  planComposition,
  assetMetadata, switchDetail, paletteGroups, validatePaletteGroups, palettePresets,
} from "./core";
import type { Asset, Scene, Layer, PlanMode, Detail, PaletteGroups } from "./types";
import { loadProject, saveProject, type Project } from "./storage";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const defaultScene = (): Scene => ({
  width: 1200,
  height: 630,
  title: "Новая композиция",
  layers: [],
  colorMap: {},
  detail: "L",
});
const uid = () => crypto.randomUUID();
const niceSize = (size: number) => `${(size / 1024).toFixed(0)} КБ`;

export async function validateProject(value: unknown): Promise<Project> {
  const p = value as Partial<Project>;
  if (
    !p ||
    p.version !== 1 ||
    !Array.isArray(p.assets) ||
    p.assets.length > 100 ||
    !p.scene ||
    !Array.isArray(p.scene.layers) ||
    p.scene.layers.length > 50
  )
    throw new Error(
      "Не удалось открыть проект. Нужен файл проекта «Сборки» версии 1.",
    );
  if (JSON.stringify(value).length > 30 * 1024 * 1024)
    throw new Error("Проект слишком большой. Максимум — 30 МБ.");
  const assets: Asset[] = [];
  const ids = new Map<string, string>();
  for (const raw of p.assets) {
    if (
      !raw ||
      typeof raw.name !== "string" ||
      typeof raw.id !== "string" ||
      typeof raw.svg !== "string"
    )
      throw new Error("В проекте есть повреждённая иллюстрация.");
    const asset = await readAsset(
      typeof raw.sourceText === "string" ? raw.sourceText : raw.svg,
      raw.name,
    );
    Object.assign(asset, assetMetadata(raw,raw.name));
    asset.name = raw.name.slice(0, 100);
    asset.tags = Array.isArray(raw.tags)
      ? raw.tags
          .filter((t: unknown) => typeof t === "string")
          .map((t: string) => t.slice(0, 50))
          .slice(0, 30)
      : asset.tags;
    ids.set(raw.id, asset.id);
    if (!assets.some((a) => a.id === asset.id)) assets.push(asset);
  }
  const scene = clone(p.scene);
  if (scene.detail === undefined) scene.detail = "L";
  if (scene.palette !== undefined) scene.palette = validatePaletteGroups(scene.palette);
  if (
    typeof scene.title !== "string" ||
    scene.title.length > 300 ||
    !scene.colorMap ||
    typeof scene.colorMap !== "object"
  )
    throw new Error("Параметры проекта повреждены.");
  scene.layers = scene.layers.map((layer: Layer) => {
    if (
      !layer ||
      typeof layer.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(layer.id) ||
      typeof layer.visible !== "boolean" ||
      typeof layer.locked !== "boolean"
    )
      throw new Error("В проекте повреждены параметры слоя.");
    return { ...layer, assetId: ids.get(layer.assetId) || "" };
  });
  composeSvg(scene, assets);
  return { version: 1, assets, scene };
}

export function mount(root: HTMLElement, options: { restore?: boolean } = {}) {
  let assets: Asset[] = [];
  let scene = defaultScene();
  let selectedId: string | null = null;
  let metadataAssetId: string | null = null;
  let mode: PlanMode = "meaning";
  let palette: PaletteGroups = clone(palettePresets.lilac);
  let filter = "";
  let busy = false;
  let history: Scene[] = [];
  let future: Scene[] = [];
  let revision = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  let planningVariant = 0;
  let pointer:
    | {
        id: number;
        x: number;
        y: number;
        layerX: number;
        layerY: number;
        target: SVGSVGElement;
      }
    | undefined;
  const sampleButtons = [
    ["Совместное решение", "Пазлы, наушники"],
    ["Новые идеи", "Лампа, книга"],
    ["Разумные расходы", "Кошелек, монета"],
  ];
  root.innerHTML = `<a class="skip" href="#prompt">К описанию композиции</a><header class="topbar"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true">⌘</span><span>сборка<span class="brand-caption">Векторные композиции</span></span></a><div class="document-name"><label class="sr-only" for="document-title">Название композиции</label><input id="document-title" maxlength="100" value="Новая композиция"><span class="document-type">SVG</span></div><div class="top-actions"><button id="open-project" class="quiet">Открыть проект</button><button id="save-project" class="quiet">Сохранить проект</button><button id="export-svg" class="primary" disabled>Экспорт SVG <span aria-hidden="true">↗</span></button></div></header>
 <main class="editor"><aside class="library-panel"><div class="panel-heading"><h1>Библиотека</h1><span id="library-count" class="count">0</span></div><p class="panel-intro">Исходные объекты.<br>Геометрия остаётся неизменной.</p><button id="import-svg" class="secondary upload-button"><span aria-hidden="true">+</span> Загрузить SVG</button><label class="sr-only" for="library-search">Найти объект</label><input id="library-search" type="search" placeholder="Найти объект…" autocomplete="off"><label class="sr-only" for="library-metadata">Изменить свойства исходника</label><select id="library-metadata" aria-label="Изменить свойства исходника"><option value="">Свойства любого исходника…</option></select><div id="library-grid" class="library-grid"></div><div class="library-footer"><span class="tiny-label">Только векторы</span><p>Загрузите SVG из исходной библиотеки работодателя. Новые объекты сервис не генерирует.</p></div></aside>
 <section class="work-area" aria-label="Рабочая область"><div class="prompt-panel"><div class="prompt-top"><label for="prompt">Что собираем?</label><div class="mode-switch" role="group" aria-label="Способ подбора"><button data-mode="meaning" aria-pressed="true">По смыслу</button><button data-mode="objects" aria-pressed="false">По объектам</button></div></div><div class="prompt-row"><input id="prompt" placeholder="Заголовок или метафора, например «Совместное решение»" maxlength="300"><button id="compose" class="primary" disabled>Собрать <span aria-hidden="true">→</span></button></div><div class="prompt-examples">${sampleButtons.map(([label, objects]) => `<button data-prompt="${label}" data-objects="${objects}">${label}</button>`).join("")}<span>Подбор по названиям и тегам</span></div><p id="plan-explanation" class="plan-explanation" role="status">Загрузите библиотеку, чтобы начать подбор.</p></div>
 <div class="canvas-toolbar"><div><label for="detail-size">Детализация</label><select id="detail-size"><option value="L">L · подробно</option><option value="S">S · упрощённо</option></select></div><div><label for="canvas-size">Холст</label><select id="canvas-size"><option value="1200x630">1200 × 630 · обложка</option><option value="1080x1080">1080 × 1080 · квадрат</option><option value="1080x1920">1080 × 1920 · вертикаль</option><option value="1600x900">1600 × 900 · 16:9</option></select></div><div class="history-tools"><button id="undo" class="icon-button" aria-label="Отменить действие" disabled>↶</button><button id="redo" class="icon-button" aria-label="Повторить действие" disabled>↷</button><button id="variant" class="quiet" disabled>Другой вариант</button></div></div><div class="canvas-viewport" id="canvas-drop" tabindex="0" aria-label="Холст композиции. Перетаскивайте объекты или используйте стрелки для перемещения."><div class="canvas-paper"><div id="stage"></div></div><div class="canvas-empty" id="canvas-empty"><span class="empty-glyph" aria-hidden="true">▧</span><h2>Композиция начинается<br>с исходников</h2><p>Загрузите SVG, затем опишите идею<br>или добавьте объекты из библиотеки.</p><button id="empty-import" class="secondary">Выбрать SVG-файлы</button><span>Объекты и результат сохраняются в векторе.</span></div></div><div class="canvas-status"><span id="selection-status">Ничего не выбрано</span><span id="save-status" role="status">Проект сохраняется только на этом устройстве</span></div><p id="message" class="message" role="status" aria-live="polite"></p></section>
 <aside class="inspector-panel"><section class="inspector-section"><div class="panel-heading"><h2>Объект</h2><span id="object-index" class="subtle">—</span></div><p id="object-empty" class="panel-intro">Выберите объект на холсте,<br>чтобы изменить его положение.</p><div id="object-controls" hidden><label for="asset-name">Название в библиотеке</label><input id="asset-name" maxlength="100"><label for="asset-family">Семейство компонента</label><input id="asset-family" maxlength="100"><div class="metadata-grid"><label for="asset-detail">Детализация<select id="asset-detail"><option>S</option><option>L</option></select></label><label for="asset-role">Назначение<select id="asset-role"><option value="main">Основной объект</option><option value="background">Фоновый объект</option></select></label></div><label for="asset-tags">Теги для подбора</label><input id="asset-tags" placeholder="Идея, знание, работа" maxlength="300"><div class="numeric-grid"><label>X<input type="number" id="layer-x" step="1"></label><label>Y<input type="number" id="layer-y" step="1"></label><label>Масштаб, %<input type="number" id="layer-scale" min="0.1" max="10000" step="1"></label><label>Поворот, °<input type="number" id="layer-rotation" min="-360" max="360" step="1"></label></div><div class="object-actions"><button id="duplicate" class="secondary">Дублировать</button><button id="delete-layer" class="quiet danger">Удалить</button></div><p id="source-proof" class="source-proof"></p></div></section>
 <section class="inspector-section"><div class="panel-heading"><h2>Палитра</h2><button id="import-palette" class="text-button">Загрузить</button></div><p class="small-copy">Фон использует только цвета фона; основные объекты — обе группы. Тёмные контуры сохраняются.</p><div class="palette-choices"><button data-palette="lilac">Сирень</button><button data-palette="sand">Песок</button><button data-palette="mint">Мята</button></div><div id="palette-swatches" class="palette-swatches"></div><div class="palette-actions"><button id="apply-palette" class="secondary" disabled>Применить</button><button id="original-colors" class="quiet" disabled>Исходные цвета</button></div><p class="field-hint">TXT или JSON-массив: 2–8 цветов объектов, фон — нейтральный. JSON с background и objects: 1–8 HEX-цветов в каждой группе.</p></section>
 <section class="inspector-section layer-section"><div class="panel-heading"><h2>Слои</h2><span id="layer-count" class="count">0</span></div><p class="small-copy">Верхний слой — передний план.</p><div id="layers"></div><div class="layer-actions"><button id="layer-up" class="quiet" disabled>↑ Вперёд</button><button id="layer-down" class="quiet" disabled>↓ Назад</button></div></section></aside></main>
 <input id="svg-files" type="file" accept=".svg,image/svg+xml" multiple hidden><input id="project-file" type="file" accept=".json,application/json" hidden><input id="palette-file" type="file" accept=".txt,.json,text/plain,application/json" hidden>`;
  const $ = <T extends HTMLElement = HTMLElement>(q: string) =>
    root.querySelector<T>(q)!;
  const field = (q: string) => $<HTMLInputElement>(q);
  const assetById = (id: string) => assets.find((a) => a.id === id);
  const selected = () => scene.layers.find((l) => l.id === selectedId);
  const project = (): Project => ({
    version: 1,
    assets: clone(assets),
    scene: clone(scene),
  });
  const notify = (text: string, error = false) => {
    $("#message").textContent = text;
    $("#message").classList.toggle("error", error);
  };
  const checkpoint = () => {
    history.push(clone(scene));
    if (history.length > 40) history.shift();
    future = [];
    revision++;
  };
  const scheduleSave = () => {
    revision++;
    if (saveTimer) clearTimeout(saveTimer);
    $("#save-status").textContent = "Сохраняю…";
    saveTimer = setTimeout(() => {
      const snapshot = project();
      saveQueue = saveQueue
        .catch(() => {})
        .then(() => saveProject(snapshot))
        .then(() => {
          $("#save-status").textContent = "Сохранено на этом устройстве";
        })
        .catch(() => {
          $("#save-status").textContent =
            "Не удалось сохранить. Скачайте проект.";
        });
    }, 350);
  };
  const download = (body: string, mime: string, name: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const safeName = () =>
    scene.title
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 70) || "Композиция";
  function fitCanvas() {
    const viewport = $("#canvas-drop");
    const paper = $(".canvas-paper");
    const availableW = Math.max(180, viewport.clientWidth - 48),
      availableH = Math.max(180, viewport.clientHeight - 48);
    paper.style.width =
      Math.min(availableW, (availableH * scene.width) / scene.height) + "px";
    paper.style.aspectRatio = `${scene.width} / ${scene.height}`;
  }
  function paintSelection() {
    const svg = $("#stage").querySelector("svg");
    if (!svg) return;
    svg.querySelector("[data-selection]")?.remove();
    const layer = selected();
    if (!layer || !layer.visible) return;
    const asset = assetById(layer.assetId);
    if (!asset) return;
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.setAttribute("data-selection", "");
    g.setAttribute(
      "transform",
      `translate(${layer.x} ${layer.y}) rotate(${layer.rotation})`,
    );
    g.setAttribute("pointer-events", "none");
    const r = document.createElementNS(ns, "rect");
    const w = asset.width * layer.scale,
      h = asset.height * layer.scale;
    r.setAttribute("x", String(-w / 2));
    r.setAttribute("y", String(-h / 2));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("fill", "none");
    r.setAttribute("stroke", layer.locked ? "#9A9EAA" : "#7165B7");
    r.setAttribute("stroke-width", "1.5");
    r.setAttribute("vector-effect", "non-scaling-stroke");
    g.append(r);
    svg.append(g);
  }
  function paintStage() {
    try {
      $("#stage").innerHTML = composeSvg(scene, assets);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось собрать SVG.",
        true,
      );
      return;
    }
    const svg = $("#stage").querySelector<SVGSVGElement>("svg")!;
    svg.setAttribute("aria-label", "Векторная композиция");
    svg.setAttribute("role", "img");
    const visible = scene.layers.filter((l) => l.visible);
    Array.from(svg.children)
      .filter((e) => e.tagName.toLowerCase() === "g")
      .forEach((g, i) => {
        if (visible[i]) {
          (g as SVGGElement).dataset.layerId = visible[i].id;
          g.setAttribute("class", "canvas-object");
        }
      });
    $("#canvas-empty").hidden = scene.layers.length > 0;
    paintSelection();
    fitCanvas();
  }
  function renderLibrary() {
    $("#library-count").textContent = String(assets.length);
    const q = filter.trim().toLocaleLowerCase("ru");
    const visible = assets.filter((a) => a.detail === (scene.detail ?? "L")).filter((a) =>
      (a.name + " " + a.tags.join(" ")).toLocaleLowerCase("ru").includes(q),
    );
    $("#library-grid").innerHTML = assets.length
      ? visible.length
        ? visible
            .map(
              (a) =>
                `<div class="asset-entry"><button class="asset-card" data-add="${escape(a.id)}" title="Добавить ${escape(a.name)} на холст"><span class="asset-preview"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.svg)}" alt="" loading="lazy"></span><strong>${escape(a.name)}</strong><span>${a.detail} · ${a.role === "main" ? "Основной объект" : "Фоновый объект"}</span><span>${escape(a.family)} · ${Math.round(a.width)} × ${Math.round(a.height)}</span></button><button class="asset-settings quiet" data-edit="${escape(a.id)}">Свойства</button></div>`,
            )
            .join("")
        : `<p class="library-empty">${q ? "По этому запросу нет объектов. Попробуйте название из файла." : `Нет исходников ${scene.detail ?? "L"}. Выберите другую детализацию или измените свойства исходника в списке выше.`}</p>`
      : '<div class="library-empty"><span aria-hidden="true">↥</span><strong>Ваша исходная библиотека</strong><p>Добавьте SVG-файлы. Их можно будет использовать в нескольких композициях.</p></div>';
    const metadataSelect = root.querySelector<HTMLSelectElement>("#library-metadata");
    if(metadataSelect) metadataSelect.innerHTML = '<option value="">Свойства любого исходника…</option>' + assets.map(a=>`<option value="${escape(a.id)}">${escape(a.family)} · ${a.detail} · ${a.role === "main" ? "основной" : "фон"}</option>`).join("");
    $<HTMLButtonElement>("#compose").disabled = busy || !assets.some(a => a.detail === (scene.detail ?? "L"));
  }
  function renderInspector() {
    const layer = selected(),
      asset = layer ? assetById(layer.assetId) : metadataAssetId ? assetById(metadataAssetId) : undefined;
    $("#object-empty").hidden = !!asset;
    $("#object-controls").hidden = !asset;
    $("#object-index").textContent = layer
      ? `${scene.layers.indexOf(layer) + 1} / ${scene.layers.length}`
      : "—";
    if (asset) {
      for (const [id, val] of [
        ["#asset-name", asset.name],
        ["#asset-tags", asset.tags.join(", ")],
        ["#asset-family", asset.family],
        ["#asset-detail", asset.detail],
        ["#asset-role", asset.role],
        ["#layer-x", String(Math.round(layer?.x ?? 0))],
        ["#layer-y", String(Math.round(layer?.y ?? 0))],
        ["#layer-scale", String(Math.round((layer?.scale ?? 1) * 1000) / 10)],
        ["#layer-rotation", String(Math.round(layer?.rotation ?? 0))],
      ])
        if (document.activeElement !== field(id)) field(id).value = val;
      for (const id of [
        "#layer-x",
        "#layer-y",
        "#layer-scale",
        "#layer-rotation",
      ])
        field(id).disabled = !layer || layer.locked;
      $("#source-proof").textContent =
        `Исходник сохранён · SHA-256 ${asset.sourceHash.slice(0, 12)}…`;
    }
    $("#layer-count").textContent = String(scene.layers.length);
    $("#layers").innerHTML = scene.layers.length
      ? [...scene.layers]
          .reverse()
          .map(
            (l) =>
              `<div class="layer-row ${l.id === selectedId ? "selected" : ""}"><button class="layer-pick" data-select="${escape(l.id)}" aria-pressed="${l.id === selectedId}"><span class="layer-glyph" aria-hidden="true">▧</span><span>${escape(assetById(l.assetId)?.name || "Объект")}</span></button><button class="layer-icon" data-visible="${escape(l.id)}" aria-label="${l.visible ? "Скрыть" : "Показать"} ${escape(assetById(l.assetId)?.name || "объект")}" aria-pressed="${l.visible}">${l.visible ? "◉" : "○"}</button><button class="layer-icon" data-lock="${escape(l.id)}" aria-label="${l.locked ? "Разблокировать" : "Заблокировать"} ${escape(assetById(l.assetId)?.name || "объект")}" aria-pressed="${l.locked}">${l.locked ? "▣" : "▫"}</button></div>`,
          )
          .join("")
      : '<p class="small-copy layer-empty">Объекты появятся здесь<br>после добавления на холст.</p>';
    for (const id of ["#layer-up", "#layer-down", "#duplicate", "#delete-layer"])
      $<HTMLButtonElement>(id).disabled = !layer;
    $<HTMLButtonElement>("#undo").disabled = !history.length;
    $<HTMLButtonElement>("#redo").disabled = !future.length;
    $<HTMLButtonElement>("#export-svg").disabled = !scene.layers.some(
      (l) => l.visible,
    );
    $<HTMLButtonElement>("#apply-palette").disabled = !scene.layers.length;
    $<HTMLButtonElement>("#original-colors").disabled = !scene.palette && !Object.keys(
      scene.colorMap,
    ).length;
    $<HTMLButtonElement>("#variant").disabled = !scene.layers.length;
    $("#selection-status").textContent = layer
      ? `${asset?.name} · ${layer.locked ? "слой заблокирован" : "двигайте мышью или стрелками"}`
      : `${scene.layers.length} объектов · ${scene.width} × ${scene.height}`;
  }
  function renderPalette() {
    $("#palette-swatches").innerHTML = (["objects","background"] as const).map(group => `<div class="palette-group"><h3>${group === "objects" ? "Цвета объектов" : "Цвета фона"}</h3><div class="palette-group-chips">${palette[group].map((color,i)=>`<label class="swatch" title="Цвет ${i+1}: ${color}"><input type="color" data-color="${i}" data-group="${group}" value="${color}" aria-label="${group === "objects" ? "Цвет объектов" : "Цвет фона"} ${i+1}"><span>${color}</span></label>`).join("")}</div></div>`).join("");
  }
  function render() {
    $<HTMLSelectElement>("#detail-size").value = scene.detail ?? "L";
    paintStage();
    renderLibrary();
    renderInspector();
    renderPalette();
    field("#document-title").value = scene.title;
    const size = $<HTMLSelectElement>("#canvas-size");
    const value = `${scene.width}x${scene.height}`;
    size.querySelector("[data-custom]")?.remove();
    if (!Array.from(size.options).some((o) => o.value === value)) {
      const option = new Option(`${scene.width} × ${scene.height}`, value);
      option.dataset.custom = "";
      size.append(option);
    }
    size.value = value;
  }
  function addAsset(id: string) {
    const asset = assetById(id);
    if (!asset || asset.detail !== (scene.detail ?? "L")) return;
    if (scene.layers.length >= 50) {
      notify(
        "На холсте уже 50 объектов. Удалите ненужные перед добавлением.",
        true,
      );
      return;
    }
    checkpoint();
    const scale = Math.min(
      (scene.width * 0.4) / asset.width,
      (scene.height * 0.55) / asset.height,
      1,
    );
    const offset = (scene.layers.length % 5) * 18;
    const layer: Layer = {
      id: uid(),
      assetId: id,
      x: scene.width / 2 + offset,
      y: scene.height / 2 + offset,
      scale,
      rotation: 0,
      visible: true,
      locked: false,
    };
    scene.layers.push(layer);
    selectedId = layer.id;
    render();
    scheduleSave();
    notify("Объект добавлен из исходной библиотеки.");
  }
  async function importSVG(files: File[]) {
    if (busy) return;
    busy = true;
    revision++;
    renderLibrary();
    notify("Проверяю исходные SVG…");
    try {
      if (
        files.length + assets.length > 100 ||
        files.reduce((n, f) => n + f.size, 0) +
          assets.reduce((n, a) => n + (a.sourceText || a.svg).length, 0) >
          25 * 1024 * 1024
      )
        throw new Error(
          "Для одного проекта можно загрузить до 100 объектов общим объёмом 25 МБ.",
        );
      const loaded: Asset[] = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          if (!/\.svg$/i.test(file.name)) throw new Error("нужен файл SVG");
          if (file.size > 3 * 1024 * 1024) throw new Error("больше 3 МБ");
          const asset = await readAsset(await file.text(), file.name);
          if (!/--[SL]--(?:main|background)\.svg$/i.test(file.name)) asset.detail = scene.detail ?? "L";
          loaded.push(asset);
        } catch (e) {
          errors.push(
            `${file.name}: ${e instanceof Error ? e.message : "не удалось прочитать"}`,
          );
        }
      }
      let added = 0;
      for (const asset of loaded)
        if (!assets.some((a) => a.id === asset.id)) {
          assets.push(asset);
          added++;
        }
      render();
      if (added) scheduleSave();
      notify(
        `Добавлено: ${added}. Повторы: ${loaded.length - added}.${errors.length ? " Не загружено: " + errors.join("; ") : " Объекты проверены, их геометрия сохранена."}`,
        !!errors.length,
      );
      if (added)
        $("#plan-explanation").textContent =
          "Библиотека готова. Опишите идею или добавьте объекты вручную.";
    } catch (e) {
      notify(e instanceof Error ? e.message : "Ошибка загрузки", true);
    } finally {
      busy = false;
      renderLibrary();
      field("#svg-files").value = "";
    }
  }
  root.onclick = (event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (!b || b.disabled) return;
    if (["import-svg", "empty-import"].includes(b.id))
      field("#svg-files").click();
    if (b.id === "open-project") field("#project-file").click();
    if (b.id === "import-palette") field("#palette-file").click();
    if (b.dataset.add) addAsset(b.dataset.add);
    if (b.dataset.edit) { selectedId=null;metadataAssetId=b.dataset.edit;renderInspector();paintSelection(); }
    if (b.dataset.mode) {
      mode = b.dataset.mode as PlanMode;
      root
        .querySelectorAll<HTMLButtonElement>("[data-mode]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.mode === mode),
          ),
        );
      field("#prompt").placeholder =
        mode === "meaning"
          ? "Заголовок или метафора, например «Совместное решение»"
          : "Названия объектов, например «Пазлы, наушники»";
    }
    if (b.dataset.prompt) {
      field("#prompt").value =
        mode === "objects" ? b.dataset.objects! : b.dataset.prompt;
    }
    if (b.dataset.select) {
      selectedId = b.dataset.select;
      renderInspector();
      paintSelection();
    }
    if (b.dataset.visible || b.dataset.lock) {
      const l = scene.layers.find(
        (l) => l.id === (b.dataset.visible || b.dataset.lock),
      );
      if (l) {
        checkpoint();
        b.dataset.visible ? (l.visible = !l.visible) : (l.locked = !l.locked);
        render();
        scheduleSave();
      }
    }
    if (b.id === "compose" || b.id === "variant") {
      try {
        const prompt = field("#prompt").value.trim();
        if (!prompt) {
          notify("Опишите идею или назовите объекты из библиотеки.", true);
          return;
        }
        const plan = planComposition(
          assets,
          prompt,
          mode,
          scene.width,
          scene.height,
          b.id === "variant" ? ++planningVariant : 0,
          scene.detail ?? "L",
        );
        $("#plan-explanation").textContent = plan.explanation;
        if (!plan.layers.length) {
          notify(
            "Подходящих объектов пока нет. Уточните названия или добавьте теги в свойствах объекта.",
            true,
          );
          return;
        }
        checkpoint();
        scene.layers = plan.layers;
        selectedId = scene.layers[0].id;
        render();
        scheduleSave();
        notify("Композиция собрана только из объектов библиотеки.");
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Не удалось собрать композицию.",
          true,
        );
      }
    }
    if (b.id === "undo" && history.length) {
      future.push(clone(scene));
      scene = history.pop()!;
      selectedId = null;
      render();
      scheduleSave();
    }
    if (b.id === "redo" && future.length) {
      history.push(clone(scene));
      scene = future.pop()!;
      selectedId = null;
      render();
      scheduleSave();
    }
    if (b.id === "duplicate") {
      const l = selected();
      if (l && scene.layers.length < 50) {
        checkpoint();
        const next = {
          ...l,
          id: uid(),
          x: l.x + 24,
          y: l.y + 24,
          locked: false,
        };
        scene.layers.push(next);
        selectedId = next.id;
        render();
        scheduleSave();
      }
    }
    if (b.id === "delete-layer") {
      const l = selected();
      if (l && !l.locked) {
        checkpoint();
        scene.layers = scene.layers.filter((x) => x.id !== selectedId);
        selectedId = null;
        render();
        scheduleSave();
      } else if (l) notify("Сначала разблокируйте слой.", true);
    }
    if (["layer-up", "layer-down"].includes(b.id)) {
      const l = selected();
      if (l) {
        const i = scene.layers.indexOf(l),
          j = i + (b.id === "layer-up" ? 1 : -1);
        if (j >= 0 && j < scene.layers.length) {
          checkpoint();
          [scene.layers[i], scene.layers[j]] = [
            scene.layers[j],
            scene.layers[i],
          ];
          render();
          scheduleSave();
        }
      }
    }
    if (b.dataset.palette) {
      palette = clone(palettePresets[b.dataset.palette]);
      renderPalette();
    }
    if (b.id === "apply-palette") {
      try {
        checkpoint();
        scene.palette = validatePaletteGroups(palette);
        scene.colorMap = {};
        render();
        scheduleSave();
        notify("Заливки перекрашены. Исходные SVG сохранены отдельно.");
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Не удалось применить палитру.",
          true,
        );
      }
    }
    if (b.id === "original-colors") {
      checkpoint();
      scene.colorMap = {};
      delete scene.palette;
      render();
      scheduleSave();
    }
    if (b.id === "export-svg") {
      try {
        download(
          composeSvg(scene, assets),
          "image/svg+xml;charset=utf-8",
          safeName() + ".svg",
        );
        notify("SVG экспортирован: группы и векторные объекты редактируются.");
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Не удалось экспортировать SVG.",
          true,
        );
      }
    }
    if (b.id === "save-project") {
      download(
        JSON.stringify(project(), null, 2),
        "application/json;charset=utf-8",
        safeName() + ".sborka.json",
      );
      notify(
        "Проект сохранён вместе с исходниками и слоями. Не публикуйте закрытую библиотеку без разрешения её владельца.",
      );
    }
  };
  root.oninput = (event) => {
    const t = event.target as HTMLInputElement;
    if (t.id === "library-search") {
      filter = t.value;
      renderLibrary();
    }
    if (t.id === "document-title") {
      scene.title = t.value;
      scheduleSave();
    }
    if (t.dataset.color !== undefined) {
      palette[t.dataset.group as keyof PaletteGroups][Number(t.dataset.color)] = t.value;
      const label = t.closest("label");
      if (label) {
        label.title = `Цвет ${Number(t.dataset.color) + 1}: ${t.value}`;
        label.querySelector("span")!.textContent = t.value.toUpperCase();
      }
    }
  };
  root.onchange = async (event) => {
    const t = event.target as HTMLInputElement;
    if (t.id === "detail-size") {
      try { const next = switchDetail(scene,assets,t.value as Detail); checkpoint();scene=next;metadataAssetId=null;render();scheduleSave();notify("Детализация переключена на исходные компоненты " + scene.detail + "."); }
      catch(e) { render();notify(e instanceof Error ? e.message : "Не удалось переключить детализацию.",true); }
    }
    if (t.id === "library-metadata") { selectedId=null;metadataAssetId=t.value;renderInspector();paintSelection(); }
    if (["asset-family","asset-detail","asset-role"].includes(t.id)) {
      const layer = selected();const asset = layer ? assetById(layer.assetId) : assets.find(a=>a.id===metadataAssetId);
      if(asset)try {
        const key = t.id.slice(6) as "family" | "detail" | "role";
        const metadata = assetMetadata({...asset,[key]:t.value},asset.name);
        const candidate = {...asset,...metadata};const nextAssets=assets.map(a=>a===asset?candidate:a);
        if(scene.layers.some(l=>l.assetId===asset.id)) {
          if(metadata.detail !== (scene.detail ?? "L")) throw new Error("Сначала уберите объект с холста: его детализация должна совпадать с композицией.");
          switchDetail(scene,nextAssets,scene.detail ?? "L");
        }
        // Old scene snapshots can reference this source in its previous detail.
        if (metadata.detail !== asset.detail) { history=[];future=[]; }
        Object.assign(asset,metadata);renderLibrary();renderInspector();paintStage();scheduleSave();notify("Метаданные сохранены. Для переключения S/L нужна единственная пара с тем же семейством и назначением.");
      } catch(e) { renderInspector(); field("#"+t.id).value=String(asset[t.id.slice(6) as "family"|"detail"|"role"]);notify(e instanceof Error?e.message:"Некорректные свойства.",true); }
    }
    if (t.id === "svg-files") await importSVG(Array.from(t.files || []));
    if (t.id === "palette-file") {
      try {
        const f = t.files?.[0];
        if (!f) return;
        if (f.size > 100000) throw new Error("Файл палитры слишком большой.");
        palette = paletteGroups(await f.text());
        renderPalette();
        notify(
          `Загружены цвета объектов и фона. Нажмите «Применить».`,
        );
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Не удалось загрузить палитру.",
          true,
        );
      } finally {
        t.value = "";
      }
    }
    if (t.id === "project-file") {
      try {
        const f = t.files?.[0];
        if (!f || busy) return;
        if (f.size > 30 * 1024 * 1024) throw new Error("Проект больше 30 МБ.");
        busy = true;
        revision++;
        renderLibrary();
        notify("Проверяю проект и исходники…");
        const p = await validateProject(JSON.parse(await f.text()));
        assets = p.assets;
        scene = p.scene;
        if(scene.palette) palette=clone(scene.palette);
        history = [];
        future = [];
        selectedId = null;
        render();
        $("#plan-explanation").textContent = assets.length
          ? "Библиотека готова. Введите заголовок или названия объектов."
          : "Загрузите библиотеку, чтобы начать подбор.";
        scheduleSave();
        notify("Проект открыт. Исходники повторно проверены.");
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Не удалось открыть проект.",
          true,
        );
      } finally {
        busy = false;
        t.value = "";
        renderLibrary();
      }
    }
    if (t.id === "canvas-size") {
      const [w, h] = t.value.split("x").map(Number);
      if (!w || !h) return;
      checkpoint();
      const rx = w / scene.width,
        ry = h / scene.height;
      scene.layers.forEach((l) => {
        l.x *= rx;
        l.y *= ry;
        l.scale *= Math.min(rx, ry);
      });
      scene.width = w;
      scene.height = h;
      render();
      scheduleSave();
    }
    if (t.id === "asset-name" || t.id === "asset-tags") {
      const l = selected(),
        a = l ? assetById(l.assetId) : assets.find(a=>a.id===metadataAssetId);
      if (a) {
        if (t.id === "asset-name")
          a.name = t.value.trim().slice(0, 100) || a.name;
        else
          a.tags = t.value
            .split(",")
            .map((x) => x.trim().slice(0, 50))
            .filter(Boolean)
            .slice(0, 30);
        renderLibrary();
        renderInspector();
        scheduleSave();
      }
    }
    if (
      ["layer-x", "layer-y", "layer-scale", "layer-rotation"].includes(t.id)
    ) {
      const l = selected();
      if (!l || l.locked) return;
      const n = Number(t.value);
      if (!t.value.trim() || !Number.isFinite(n)) {
        notify("Введите число.", true);
        renderInspector();
        return;
      }
      checkpoint();
      if (t.id === "layer-x")
        l.x = Math.max(-scene.width, Math.min(scene.width * 2, n));
      if (t.id === "layer-y")
        l.y = Math.max(-scene.height, Math.min(scene.height * 2, n));
      if (t.id === "layer-scale")
        l.scale = Math.max(0.001, Math.min(100, n / 100));
      if (t.id === "layer-rotation") l.rotation = ((n % 360) + 360) % 360;
      paintStage();
      renderInspector();
      scheduleSave();
    }
  };
  const viewport = $("#canvas-drop");
  viewport.ondragover = (e) => {
    e.preventDefault();
    viewport.classList.add("is-drop");
  };
  viewport.ondragleave = () => viewport.classList.remove("is-drop");
  viewport.ondrop = (e) => {
    e.preventDefault();
    viewport.classList.remove("is-drop");
    void importSVG(Array.from(e.dataTransfer?.files || []));
  };
  viewport.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const object = target.closest<SVGGElement>("[data-layer-id]");
    selectedId = object?.dataset.layerId || null;
    renderInspector();
    paintSelection();
    viewport.focus();
    const l = selected();
    const svg = $("#stage").querySelector<SVGSVGElement>("svg");
    if (!l || l.locked || !svg) return;
    checkpoint();
    pointer = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      layerX: l.x,
      layerY: l.y,
      target: svg,
    };
    viewport.setPointerCapture?.(e.pointerId);
  };
  viewport.onpointermove = (e) => {
    const l = selected();
    if (!pointer || e.pointerId !== pointer.id || !l) return;
    const box = pointer.target.getBoundingClientRect();
    if (!box.width || !box.height) return;
    l.x = pointer.layerX + ((e.clientX - pointer.x) * scene.width) / box.width;
    l.y =
      pointer.layerY + ((e.clientY - pointer.y) * scene.height) / box.height;
    const group = Array.from(pointer.target.children).find(
      (g) => (g as SVGGElement).dataset.layerId === l.id,
    );
    group?.setAttribute(
      "transform",
      `translate(${l.x} ${l.y}) rotate(${l.rotation}) scale(${l.scale})`,
    );
    paintSelection();
    field("#layer-x").value = String(Math.round(l.x));
    field("#layer-y").value = String(Math.round(l.y));
  };
  const endPointer = () => {
    if (pointer) {
      pointer = undefined;
      paintStage();
      renderInspector();
      scheduleSave();
    }
  };
  viewport.onpointerup = endPointer;
  viewport.onpointercancel = endPointer;
  viewport.onkeydown = (e) => {
    if (e.target !== viewport) return;
    const l = selected();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? $("#redo") : $("#undo")).click();
      return;
    }
    if (!l || l.locked) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      $("#delete-layer").click();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      checkpoint();
      const step = e.shiftKey ? 10 : 1;
      l.x += e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      l.y += e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      paintStage();
      renderInspector();
      scheduleSave();
    }
  };
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(fitCanvas).observe(viewport);
  render();
  if (options.restore !== false) {
    const initial = revision;
    loadProject()
      .then(async (value) => {
        if (!value) return;
        const p = await validateProject(value);
        if (revision !== initial) return;
        assets = p.assets;
        scene = p.scene;
        if(scene.palette) palette=clone(scene.palette);
        render();
        $("#save-status").textContent =
          "Проект восстановлен на этом устройстве";
        if (assets.length)
          $("#plan-explanation").textContent =
            "Исходная библиотека восстановлена.";
      })
      .catch(() => {
        $("#save-status").textContent =
          "Автосохранение недоступно. Скачивайте проект вручную.";
      });
  }
  return { getProject: project, importSVG, selected: () => selectedId };
}

import type { Asset, Scene, PlanMode, CompositionPlan } from "./types";
const NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";
function fail(message: string): never {
  throw new Error(message);
}
const presentation = new Set(
  "fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity stop-color stop-opacity color clip-path mask filter visibility display vector-effect paint-order color-interpolation color-interpolation-filters flood-color flood-opacity lighting-color isolation mix-blend-mode".split(
    " ",
  ),
);
const elements = new Set(
  "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern symbol use title desc metadata filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence".split(
    " ",
  ),
);
const attributes = new Set(
  "id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform preserveAspectRatio gradientUnits gradientTransform spreadMethod offset fx fy fr clipPathUnits maskUnits maskContentUnits patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end filterUnits primitiveUnits in in2 result mode type values operator k1 k2 k3 k4 stdDeviation dx dy edgeMode kernelMatrix kernelUnitLength order targetX targetY divisor bias preserveAlpha surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation scale xChannelSelector yChannelSelector baseFrequency numOctaves seed stitchTiles slope intercept amplitude exponent tableValues refX refY overflow version enable-background role aria-label".split(
    " ",
  ),
);
const colorAttrs = new Set([
  "fill",
  "stroke",
  "stop-color",
  "color",
  "flood-color",
  "lighting-color",
]);
const internalURL = /^url\(\s*(['"]?)#([A-Za-z_][\w.:-]*)\1\s*\)$/;

// Control definitions and anything they reference must retain luminance and
// inherited paint context. Shared references are conservatively protected too.
function protectedPaint(root: Element): Set<Element> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  const byId = new Map(all.filter(el => el.hasAttribute("id")).map(el => [el.getAttribute("id")!, el]));
  const protectedElements = new Set<Element>();
  const queue = all.filter(el => ["mask", "filter", "clipPath"].includes(el.localName));
  for (let index = 0; index < queue.length; index++) {
    const el = queue[index];
    if (protectedElements.has(el)) continue;
    protectedElements.add(el);
    queue.push(...Array.from(el.children));
    for (const attr of Array.from(el.attributes)) {
      const reference = attr.localName === "href" ? attr.value.slice(1) : attr.value.match(internalURL)?.[2];
      const target = reference && byId.get(reference);
      if (target) queue.push(target);
    }
  }
  // Freezing ancestor attributes retains inherited currentColor/fill without
  // materializing paint onto <use> targets, which would change shadow inheritance.
  for (const el of [...protectedElements]) {
    let parent = el.parentElement;
    while (parent) { protectedElements.add(parent); parent = parent.parentElement; }
  }
  return protectedElements;
}
function withSourceAlpha(source: string, replacement: string): string {
  const original = normalizeColor(source)!;
  const target = normalizeColor(replacement)!;
  const alpha = original.match(/^rgba\([^,]+,[^,]+,[^,]+,([^)]*)\)$/)?.[1];
  if (alpha === undefined) return target;
  const channels = target.startsWith("#")
    ? [1, 3, 5].map(pos => parseInt(target.slice(pos, pos + 2), 16))
    : target.slice(5, -1).split(",").slice(0, 3).map(Number);
  return `rgba(${channels.join(",")},${alpha})`;
}

function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[\da-f]{3}$/.test(v))
    return "#" + [...v.slice(1)].map((c) => c + c).join("");
  if (/^#[\da-f]{6}$/.test(v)) return v;
  const m = v.match(
    /^(rgb|rgba)\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/,
  );
  if (m && (m[1] === "rgba") === Boolean(m[5])) {
    const channels = m.slice(2, 5).map(Number);
    if (channels.every((n) => n <= 255)) {
      const hex =
        "#" +
        channels
          .map((n) => Math.round(n).toString(16).padStart(2, "0"))
          .join("");
      return m[5] && Number(m[5]) !== 1
        ? `rgba(${channels.join(",")},${Number(m[5])})`
        : hex;
    }
  }
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#008000",
    yellow: "#ffff00",
    gray: "#808080",
    grey: "#808080",
    transparent: "rgba(0,0,0,0)",
  };
  return named[v] ?? null;
}
function dimension(v: string | null): number | null {
  if (v === null) return null;
  if (!/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$/.test(v))
    fail(
      "Размер SVG должен быть положительным числом в пикселях. Экспортируйте SVG из Figma ещё раз.",
    );
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e7)
    fail("Недопустимый размер SVG.");
  return n;
}
function inspectUnchecked(svgText: string): {
  root: Element;
  width: number;
  height: number;
  viewBox: string;
  colors: string[];
} {
  if (new TextEncoder().encode(svgText).length > 3 * 1024 * 1024)
    fail("SVG больше 3 МиБ. Упростите исходный файл.");
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(svgText.replace(/^\s*<\?xml[^?]*\?>/, "")))
    fail("SVG содержит запрещённые инструкции XML. Экспортируйте обычный SVG.");
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.localName !== "svg")
    fail("Не удалось прочитать SVG. Проверьте корректность XML.");
  const nodes = Array.from(root.querySelectorAll("*"));
  if (nodes.length > 30000)
    fail("SVG содержит больше 30000 объектов. Упростите исходник.");
  const ids = new Set<string>();
  const colors = new Set<string>();
  for (const el of [root, ...nodes]) {
    if (
      !elements.has(el.localName) ||
      (el.namespaceURI !== NS && el.namespaceURI !== null)
    )
      fail(
        `Объект «${el.localName}» не поддерживается. Нужен чистый векторный SVG без изображений, текста и скриптов.`,
      );
    if (el.hasAttribute("style")) {
      const style = el.getAttribute("style")!;
      el.removeAttribute("style");
      for (const rule of style.split(";")) {
        if (!rule.trim()) continue;
        const sep = rule.indexOf(":");
        const key = rule.slice(0, sep).trim().toLowerCase();
        const value = rule.slice(sep + 1).trim();
        if (
          sep < 0 ||
          !presentation.has(key) ||
          !value ||
          /!important/i.test(value)
        )
          fail(
            "Встроенный стиль SVG не поддерживается. Преобразуйте оформление в атрибуты SVG.",
          );
        el.setAttribute(key, value);
      }
    }
    for (const attr of Array.from(el.attributes)) {
      const key = attr.localName;
      const val = attr.value.trim();
      if (attr.name === "xmlns" || attr.name === "xmlns:xlink") {
        if (val !== NS && val !== XLINK)
          fail("Неизвестное пространство имён SVG.");
        continue;
      }
      if (attr.namespaceURI && attr.namespaceURI !== XLINK)
        fail("Недопустимый атрибут пространства имён SVG.");
      if (
        /^on/i.test(key) ||
        (!attributes.has(key) && !presentation.has(key) && key !== "href")
      )
        fail(
          `Атрибут «${attr.name}» не поддерживается. Уберите ссылки и интерактивность из исходника.`,
        );
      if (
        /(?:javascript|data|https?|file):|[\\{}<>]|\/\*|\*\/|@import|expression\s*\(/i.test(
          val,
        )
      )
        fail(
          "SVG содержит небезопасную ссылку или выражение. Используйте только внутренние ссылки #id.",
        );
      if (key === "id") {
        if (!/^[A-Za-z_][\w.:-]*$/.test(val) || ids.has(val))
          fail(
            "SVG содержит повторяющийся или некорректный id. Экспортируйте исходник заново.",
          );
        ids.add(val);
      }
      if (key === "href" && !/^#[A-Za-z_][\w.:-]*$/.test(val))
        fail("Разрешены только внутренние ссылки SVG #id.");
      if (/url\s*\(/i.test(val) && !internalURL.test(val))
        fail(
          "Внешние ссылки SVG запрещены. Встройте векторные определения в файл.",
        );
      if (
        /\b(?:NaN|Infinity)\b/i.test(val) ||
        (key !== "id" &&
          key !== "href" &&
          !colorAttrs.has(key) &&
          Array.from(
            val.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi),
          ).some((m) => !Number.isFinite(Number(m[0]))))
      )
        fail("SVG содержит недопустимое число.");
      if (colorAttrs.has(key)) {
        const c = normalizeColor(val);
        if (c) {
          el.setAttribute(attr.name, c);

        } else if (
          ![
            "none",
            "currentColor",
            "inherit",
            "context-fill",
            "context-stroke",
          ].includes(val) &&
          !internalURL.test(val)
        )
          fail(`Цвет «${val}» не поддерживается. Используйте HEX или RGB.`);
      }
    }
  }
  const controls = protectedPaint(root);
  for (const el of [root, ...nodes]) if (!controls.has(el)) {
    for (const attr of Array.from(el.attributes)) if (colorAttrs.has(attr.localName)) {
      const color = normalizeColor(attr.value);
      if (color) colors.add(color);
    }
  }
  let width = dimension(root.getAttribute("width"));
  let height = dimension(root.getAttribute("height"));
  let vb = root.getAttribute("viewBox");
  if (vb !== null) {
    const p = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      p.length !== 4 ||
      p.some((n) => !Number.isFinite(n)) ||
      p[2] <= 0 ||
      p[3] <= 0 ||
      p.some((n) => Math.abs(n) > 1e7)
    )
      fail(
        "Некорректный viewBox SVG. Нужны четыре конечных числа с положительными размерами.",
      );
    vb = p.join(" ");
    width ??= p[2];
    height ??= p[3];
  } else {
    if (!width || !height)
      fail("В SVG нет размеров. Добавьте viewBox или ширину и высоту.");
    vb = `0 0 ${width} ${height}`;
  }
  root.setAttribute("viewBox", vb);
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", NS);
  // Rebuild the approved tree in the SVG namespace, including namespace-less imports.
  const cleanDoc = document.implementation.createDocument(NS, "svg", null);
  const normalized = cleanDoc.documentElement;
  const copies = new Map<Element, Element>([[root, normalized]]);
  for (const source of [root, ...nodes]) {
    const target = copies.get(source)!;
    for (const attr of Array.from(source.attributes))
      if (attr.name !== "xmlns")
        target.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 1) {
        const element = child as Element;
        const copy = cleanDoc.createElementNS(NS, element.localName);
        target.append(copy);
        copies.set(element, copy);
      } else if (child.nodeType === 3)
        target.append(cleanDoc.createTextNode(child.textContent ?? ""));
    }
  }
  normalized.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", NS);
  return {
    root: normalized,
    width: width!,
    height: height!,
    viewBox: vb,
    colors: [...colors],
  };
}
function inspect(svgText: string): ReturnType<typeof inspectUnchecked> {
  try {
    return inspectUnchecked(svgText);
  } catch (error) {
    if (error instanceof Error && /[А-Яа-я]/.test(error.message)) throw error;
    return fail(
      "SVG не удалось безопасно прочитать. Упростите структуру и экспортируйте его заново.",
    );
  }
}
// Explicit small vocabulary, not an image-recognition or language model.
const lexicon = [
  { object: "wallet", words: ["wallet", "кошел"], topic: "finance" },
  { object: "coin", words: ["coin", "монет"], topic: "finance" },
  {
    object: "money",
    words: ["money", "деньг", "денеж", "купюр", "банкнот"],
    topic: "finance",
  },
  {
    object: "puzzle",
    words: ["puzzle", "пазл", "головолом"],
    topic: "cooperation",
  },
  { object: "lamp", words: ["lamp", "bulb", "ламп", "лампоч"], topic: "idea" },
  { object: "hand", words: ["hand", "рук", "ладон"], topic: "cooperation" },
  {
    object: "chart",
    words: ["chart", "graph", "график", "диаграм"],
    topic: "growth",
  },
  { object: "plant", words: ["plant", "растен", "росток"], topic: "growth" },
  { object: "shield", words: ["shield", "щит"], topic: "security" },
  { object: "lock", words: ["lock", "замок", "замк"], topic: "security" },
  { object: "heart", words: ["heart", "сердц"], topic: "care" },
  {
    object: "people",
    words: ["people", "person", "человек", "люд"],
    topic: "cooperation",
  },
  { object: "rocket", words: ["rocket", "ракет"], topic: "growth" },
];
const topics: Record<string, string[]> = {
  finance: ["finance", "financial", "финанс", "богат", "сбереж", "бюджет"],
  cooperation: [
    "cooperation",
    "team",
    "сотруднич",
    "команд",
    "совмест",
    "взаимод",
    "партнер",
  ],
  idea: ["idea", "creative", "иде", "творч", "креатив"],
  growth: ["growth", "success", "развит", "рост", "успех"],
  security: ["security", "safety", "защит", "безопас", "надеж"],
  care: ["care", "love", "любов", "забот"],
};
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/[a-zа-я0-9]+/g) ?? [];
const has = (tokens: string[], prefixes: string[]) =>
  tokens.some((t) =>
    prefixes.some((p) => t === p || (p.length >= 3 && t.startsWith(p))),
  );
export async function readAsset(
  svgText: string,
  filename: string,
): Promise<Asset> {
  const info = inspect(svgText);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(svgText),
  );
  const sourceHash = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const tokens = words(filename.replace(/\.svg$/i, ""));
  const tags = new Set(tokens);
  for (const term of lexicon)
    if (has(tokens, term.words)) {
      tags.add(term.object);
      tags.add(term.topic);
    }
  for (const [topic, synonyms] of Object.entries(topics))
    if (has(tokens, synonyms)) tags.add(topic);
  return {
    id: `asset-${sourceHash}`,
    name: filename,
    tags: [...tags],
    width: info.width,
    height: info.height,
    viewBox: info.viewBox,
    svg: new XMLSerializer().serializeToString(info.root),
    colors: info.colors,
    sourceHash,
    sourceText: svgText,
  };
}
function canvas(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 100 ||
    height < 100 ||
    width > 4096 ||
    height > 4096
  )
    fail("Размер холста должен быть от 100 до 4096 пикселей.");
}
export function planComposition(
  assets: Asset[],
  prompt: string,
  mode: PlanMode,
  width: number,
  height: number,
  variant = 0,
): CompositionPlan {
  canvas(width, height);
  if (!["meaning", "objects"].includes(mode) || !Number.isSafeInteger(variant))
    fail("Неверный режим или вариант композиции.");
  const tokens = words(prompt);
  const wanted = new Set(tokens);
  const forbiddenTopics = new Set(Object.keys(topics));
  for (const term of lexicon)
    if (has(tokens, term.words)) {
      wanted.add(term.object);
      if (mode === "meaning") wanted.add(term.topic);
    }
  if (mode === "meaning")
    for (const [topic, synonyms] of Object.entries(topics))
      if (has(tokens, synonyms)) wanted.add(topic);
  const matched = assets
    .filter((a) =>
      a.tags.some(
        (tag) =>
          (mode === "meaning" || !forbiddenTopics.has(tag)) &&
          [...wanted].some(
            (w) => tag === w || (w.length >= 4 && tag.startsWith(w)),
          ),
      ),
    )
    .slice(0, 5);
  if (!matched.length)
    return {
      layers: [],
      matches: [],
      explanation:
        "Совпадения не найдены. Уточните предметы в запросе или добавьте исходный SVG вручную.",
    };
  const shift = ((variant % matched.length) + matched.length) % matched.length;
  const ordered = matched.slice(shift).concat(matched.slice(0, shift));
  const margin = Math.max(24, Math.min(width, height) * 0.06);
  const cols =
    ordered.length === 1
      ? 1
      : ordered.length === 2
        ? 2
        : ordered.length <= 4
          ? 2
          : 3;
  const rows = Math.ceil(ordered.length / cols);
  const cellW = (width - 2 * margin) / cols;
  const cellH = (height - 2 * margin) / rows;
  const layers = ordered.map((asset, i) => {
    if (
      !Number.isFinite(asset.width) ||
      !Number.isFinite(asset.height) ||
      asset.width <= 0 ||
      asset.height <= 0
    )
      fail("Некорректные размеры исходника. Импортируйте SVG заново.");
    const row = Math.floor(i / cols);
    const rowCount = Math.min(cols, ordered.length - row * cols);
    const x = width / 2 + ((i % cols) - (rowCount - 1) / 2) * cellW;
    return {
      id: `plan-${variant}-${i}`,
      assetId: asset.id,
      x,
      y: margin + cellH * (row + 0.5),
      scale: Math.min(
        100,
        (cellW * 0.84) / asset.width,
        (cellH * 0.84) / asset.height,
      ),
      rotation: 0,
      visible: true,
      locked: false,
    };
  });
  return {
    layers,
    matches: ordered.map((a) => a.name),
    explanation: `Найдено исходников: ${matched.length}. Подбор по названиям и открытому словарю предметов${mode === "meaning" ? " и тем" : ""}.`,
  };
}
export function paletteColors(input: string): string[] {
  let values: unknown;
  try {
    values = input.trim().startsWith("[")
      ? JSON.parse(input)
      : input.trim().split(/[\s,]+/);
  } catch {
    fail("Палитра: укажите список HEX-цветов или JSON-массив.");
  }
  if (
    !Array.isArray(values) ||
    values.some(
      (v) => typeof v !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(v),
    )
  )
    fail("Палитра: нужны цвета #RGB или #RRGGBB.");
  const unique = [
    ...new Set((values as string[]).map((v) => normalizeColor(v)!)),
  ];
  if (unique.length < 2 || unique.length > 8)
    fail("Палитра должна содержать от 2 до 8 разных цветов.");
  return unique;
}
export function recolorMap(
  originalColors: string[],
  palette: string[],
): Record<string, string> {
  const colors = paletteColors(JSON.stringify(palette));
  let i = 0;
  const result: Record<string, string> = {};
  for (const original of originalColors) {
    const c = normalizeColor(original);
    if (!c) fail("Недопустимый исходный цвет.");
    const dark =
      /^#[\da-f]{6}$/.test(c) &&
      [1, 3, 5].every((pos) => parseInt(c.slice(pos, pos + 2), 16) <= 48);
    result[original] = dark ? c : withSourceAlpha(c, colors[i++ % colors.length]);
  }
  return result;
}
export function composeSvg(scene: Scene, assets: Asset[]): string {
  canvas(scene.width, scene.height);
  const doc = document.implementation.createDocument(NS, "svg", null);
  const root = doc.documentElement;
  root.setAttribute("width", String(scene.width));
  root.setAttribute("height", String(scene.height));
  root.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", NS);
  const title = doc.createElementNS(NS, "title");
  title.textContent = scene.title;
  root.append(title);
  const mapping = new Map<string, string>();
  for (const [from, to] of Object.entries(scene.colorMap)) {
    const f = normalizeColor(from),
      t = normalizeColor(to);
    if (!f || !t) fail("Недопустимый цвет замены. Используйте HEX или RGB.");
    mapping.set(f, t);
  }
  const seen = new Set<string>();
  for (const [index, layer] of scene.layers.entries()) {
    if (typeof layer.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(layer.id) || seen.has(layer.id))
      fail("Слои должны иметь уникальные имена.");
    seen.add(layer.id);
    if (
      ![layer.x, layer.y, layer.scale, layer.rotation].every(Number.isFinite) ||
      layer.scale <= 0 ||
      layer.scale > 100 ||
      Math.abs(layer.x) > 1e7 ||
      Math.abs(layer.y) > 1e7 ||
      Math.abs(layer.rotation) > 1e7
    )
      fail("Недопустимое положение, поворот или масштаб слоя.");
    const asset = assets.find((a) => a.id === layer.assetId);
    if (!asset) fail("Исходный SVG слоя не найден. Импортируйте его заново.");
    if (!layer.visible) continue;
    const info = inspect(asset.svg);
    if (
      !Number.isFinite(asset.width) ||
      !Number.isFinite(asset.height) ||
      asset.width <= 0 ||
      asset.height <= 0 ||
      asset.width > 1e7 ||
      asset.height > 1e7
    )
      fail("Недопустимые размеры исходника.");
    const nested = doc.importNode(info.root, true);
    const prefix = `layer${index}-`;
    const all = [nested, ...Array.from(nested.querySelectorAll("*"))];
    const controls = protectedPaint(nested);
    for (const el of all)
      for (const attr of Array.from(el.attributes)) {
        if (attr.localName === "id")
          el.setAttribute(attr.name, prefix + attr.value);
        else if (attr.localName === "href")
          el.setAttributeNS(
            attr.namespaceURI,
            attr.name,
            "#" + prefix + attr.value.slice(1),
          );
        else if (internalURL.test(attr.value))
          el.setAttribute(
            attr.name,
            attr.value.replace(internalURL, `url(#${prefix}$2)`),
          );
        else if (colorAttrs.has(attr.localName) && !controls.has(el)) {
          const replacement = mapping.get(normalizeColor(attr.value) ?? "");
          if (replacement) el.setAttribute(attr.name, withSourceAlpha(attr.value, replacement));
        }
      }
    nested.setAttribute("x", String(-asset.width / 2));
    nested.setAttribute("y", String(-asset.height / 2));
    nested.setAttribute("width", String(asset.width));
    nested.setAttribute("height", String(asset.height));
    const group = doc.createElementNS(NS, "g");
    group.setAttribute("id", `composition-${index}`);
    group.setAttribute(
      "transform",
      `translate(${layer.x} ${layer.y}) rotate(${layer.rotation}) scale(${layer.scale})`,
    );
    group.append(nested);
    root.append(group);
  }
  return new XMLSerializer().serializeToString(root);
}

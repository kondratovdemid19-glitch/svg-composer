// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import {
  readAsset,
  planComposition,
  composeSvg,
  paletteColors,
  recolorMap,
} from "../src/core";
import type { Scene } from "../src/types";
beforeAll(() => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
});
// Hand-authored fixtures for tests only; no employer source artwork.
const d = "M1 2L17 3Q20 4 5 22Z";
const fixture = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -3 40 80"><defs><linearGradient id="g"><stop style="stop-color:rgb(255, 0, 0)"/></linearGradient><mask id="m"><path d="${d}" fill="#fff"/></mask></defs><g mask="url(#m)"><path id="p" d="${d}" style="fill:url(#g);stroke:#111"/></g><use href="#p"/></svg>`;
const parse = (s: string) =>
  new DOMParser().parseFromString(s, "image/svg+xml");
describe("source preservation", () => {
  it("preserves path, viewBox, gradients and masks and hashes original input", async () => {
    const a = await readAsset(fixture, "wallet.svg");
    expect(a.width).toBe(40);
    expect(a.height).toBe(80);
    expect(a.viewBox).toBe("-2 -3 40 80");
    expect(parse(a.svg).querySelector("path")?.getAttribute("d")).toBe(d);
    expect(a.colors).toContain("#ff0000");
    expect(a.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await readAsset(fixture, "other.svg")).id).toBe(a.id);
    expect((await readAsset(fixture + " ", "wallet.svg")).sourceHash).not.toBe(
      a.sourceHash,
    );
  });
  it("exports duplicate sources with unique internal references and editable geometry", async () => {
    const a = await readAsset(fixture, "wallet.svg");
    const scene: Scene = {
      width: 800,
      height: 600,
      title: "A < B",
      colorMap: { "#ff0000": "#00ff00" },
      layers: [0, 1, 2].map((i) => ({
        id: `l${i}`,
        assetId: a.id,
        x: 200 + i * 100,
        y: 300,
        scale: 1,
        rotation: 0,
        visible: i < 2,
        locked: false,
      })),
    };
    const raw = composeSvg(scene, [a]);
    const out = parse(raw);
    expect(out.querySelector("parsererror")?.textContent, raw).toBeUndefined();
    const ids = Array.from(out.querySelectorAll("[id]")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.querySelectorAll("path")).toHaveLength(4);
    expect(out.querySelectorAll("image,script")).toHaveLength(0);
    expect(out.querySelector("stop")?.getAttribute("stop-color")).toBe(
      "#00ff00",
    );
    for (const p of out.querySelectorAll("path"))
      expect(p.getAttribute("d")).toBe(d);
    for (const e of out.querySelectorAll("[mask]"))
      expect(ids).toContain(e.getAttribute("mask")!.slice(5, -1));
    expect(out.querySelector("title")?.textContent).toBe("A < B");
  });
});
describe("safe input", () => {
  it.each([
    "<svg><path></svg>",
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA"/></svg>',
    "<svg><script/></svg>",
    "<svg><foreignObject/></svg>",
    "<svg><a/></svg>",
    '<svg onload="x()"/>',
    "<svg><style>path{fill:red}</style></svg>",
    '<svg><use href="https://evil/x"/></svg>',
    '<svg><path style="fill:red;position:fixed"/></svg>',
    '<svg><path fill="url(https://evil/x)"/></svg>',
    "<svg><animate/></svg>",
    '<!DOCTYPE svg [<!ENTITY x "x">]><svg/>',
  ])("rejects unsafe or unsupported source %s", async (s) => {
    await expect(readAsset(s, "bad.svg")).rejects.toThrow(/[А-Яа-я]/);
  });
  it.each(["NaN 0 10 10", "0 0 Infinity 10", "0 0 -1 10", "0 0 0 5", "0 0 1"])(
    "rejects invalid viewBox %s",
    async (v) => {
      await expect(
        readAsset(`<svg viewBox="${v}"/>`, "x.svg"),
      ).rejects.toThrow();
    },
  );
  it("rejects oversized input and excessive structure", async () => {
    await expect(
      readAsset("<svg>" + " ".repeat(3 * 1024 * 1024) + "</svg>", "x"),
    ).rejects.toThrow();
    await expect(
      readAsset("<svg>" + "<g/>".repeat(30001) + "</svg>", "x"),
    ).rejects.toThrow();
  });
  it("revalidates imported assets and scene transforms at export", async () => {
    const a = await readAsset(
      '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
      "x",
    );
    const scene: Scene = {
      width: 500,
      height: 500,
      title: "",
      colorMap: {},
      layers: [
        {
          id: "a",
          assetId: a.id,
          x: 10,
          y: 10,
          scale: 1,
          rotation: 0,
          visible: true,
          locked: false,
        },
      ],
    };
    expect(() =>
      composeSvg(
        { ...scene, layers: [{ ...scene.layers[0], scale: Infinity }] },
        [a],
      ),
    ).toThrow();
    expect(() =>
      composeSvg({ ...scene, colorMap: { "#fff": "url(https://evil)" } }, [a]),
    ).toThrow();
    expect(() =>
      composeSvg(scene, [{ ...a, svg: "<svg><script/></svg>" }]),
    ).toThrow();
    expect(() =>
      composeSvg({ ...scene, layers: [scene.layers[0], scene.layers[0]] }, [a]),
    ).toThrow();
  });
});
describe("honest planning", () => {
  it("matches Russian inflections and meaning synonyms but never invents unmatched content", async () => {
    const wallet = await readAsset(
      '<svg viewBox="0 0 400 10"><path d="M1 1"/></svg>',
      "wallet.svg",
    );
    expect(
      planComposition([wallet], "кошельками", "objects", 800, 600).layers,
    ).toHaveLength(1);
    expect(
      planComposition([wallet], "финансовая независимость", "meaning", 800, 600)
        .layers,
    ).toHaveLength(1);
    expect(
      planComposition([wallet], "финансовая независимость", "objects", 800, 600)
        .layers,
    ).toHaveLength(0);
    const miss = planComposition([wallet], "океан", "meaning", 800, 600);
    expect(miss.layers).toHaveLength(0);
    expect(miss.explanation).toMatch(/не найден|нет совпад/i);
  });
  it("keeps all original aspect ratios in bounds and changes variants deterministically", async () => {
    const assets = await Promise.all(
      ["wallet", "coin", "puzzle", "lamp", "money"].map((n, i) =>
        readAsset(
          `<svg viewBox="0 0 ${i % 2 ? 10 : 1000} ${i % 2 ? 1000 : 10}"><path d="M${i} 0"/></svg>`,
          n,
        ),
      ),
    );
    const plan = planComposition(
      assets,
      "wallet coin puzzle lamp money",
      "objects",
      900,
      600,
    );
    expect(plan.layers).toHaveLength(5);
    for (const l of plan.layers) {
      const a = assets.find((a) => a.id === l.assetId)!;
      expect(l.x - (a.width * l.scale) / 2).toBeGreaterThanOrEqual(23);
      expect(l.x + (a.width * l.scale) / 2).toBeLessThanOrEqual(877);
      expect(l.y - (a.height * l.scale) / 2).toBeGreaterThanOrEqual(23);
      expect(l.y + (a.height * l.scale) / 2).toBeLessThanOrEqual(577);
    }
    expect(
      planComposition(
        assets,
        "wallet coin puzzle lamp money",
        "objects",
        900,
        600,
        1,
      ).layers,
    ).not.toEqual(plan.layers);
    expect(() =>
      planComposition(assets, "wallet", "objects", 99, 600),
    ).toThrow();
  });
});
describe("palettes", () => {
  it("parses strict lists and JSON and normalizes unique colors", () => {
    expect(paletteColors("#fff, #ABC\n#000")).toEqual([
      "#ffffff",
      "#aabbcc",
      "#000000",
    ]);
    expect(paletteColors('["#fff","#000"]')).toEqual(["#ffffff", "#000000"]);
  });
  it.each([
    "#fff",
    "red blue",
    "#fff url(x)",
    "#fff #ffffff",
    '["#fff",1]',
    "#ffff #000",
  ])("rejects malformed palette %s", (s) =>
    expect(() => paletteColors(s)).toThrow(),
  );
  it("maps deterministically and keeps near black outlines without mutating input", () => {
    const originals = ["#111111", "#ff0000", "#00ff00"];
    expect(recolorMap(originals, ["#ffffff", "#0000ff"])).toEqual({
      "#111111": "#111111",
      "#ff0000": "#ffffff",
      "#00ff00": "#0000ff",
    });
    expect(originals).toEqual(["#111111", "#ff0000", "#00ff00"]);
  });
});

describe("review regressions", () => {
  it("exports SVG lacking original namespace as valid vector XML and preserves rgba alpha", async () => {
    const a = await readAsset(
      '<svg viewBox="0 0 10 10"><path d="M0 0L3 3" fill="rgba(10,20,30,0.5)"/></svg>',
      "lamp",
    );
    const out = parse(
      composeSvg(
        {
          width: 400,
          height: 400,
          title: "",
          colorMap: {},
          layers: [
            {
              id: "x",
              assetId: a.id,
              x: 200,
              y: 200,
              scale: 1,
              rotation: 15,
              visible: true,
              locked: false,
            },
          ],
        },
        [a],
      ),
    );
    expect(out.querySelector("parsererror")).toBeNull();
    expect(out.querySelector("path")?.getAttribute("fill")).toBe(
      "rgba(10,20,30,0.5)",
    );
    expect(out.querySelector("path")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });
  it("rejects infinite numeric geometry and bounded export scale", async () => {
    await expect(
      readAsset('<svg viewBox="0 0 10 10"><path d="M1e999 0"/></svg>', "x"),
    ).rejects.toThrow();
    const a = await readAsset('<svg viewBox="0 0 10 10"/>', "x");
    expect(() =>
      composeSvg(
        {
          width: 400,
          height: 400,
          title: "",
          colorMap: {},
          layers: [
            {
              id: "x",
              assetId: a.id,
              x: 200,
              y: 200,
              scale: 101,
              rotation: 0,
              visible: true,
              locked: false,
            },
          ],
        },
        [a],
      ),
    ).toThrow();
  });
  it("preserves internal xlink references and filter primitives", async () => {
    const a = await readAsset(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 30 30"><defs><path id="source" d="M0 0L5 5"/><filter id="filter"><feGaussianBlur stdDeviation="2"/></filter></defs><use xlink:href="#source" filter="url(#filter)"/></svg>',
      "x",
    );
    const out = parse(
      composeSvg(
        {
          width: 400,
          height: 400,
          title: "",
          colorMap: {},
          layers: [
            {
              id: "x",
              assetId: a.id,
              x: 200,
              y: 200,
              scale: 1,
              rotation: 0,
              visible: true,
              locked: false,
            },
          ],
        },
        [a],
      ),
    );
    expect(out.querySelector("parsererror")).toBeNull();
    expect(
      out
        .querySelector("use")
        ?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    ).toBe("#layer0-source");
    expect(
      out.querySelector("feGaussianBlur")?.getAttribute("stdDeviation"),
    ).toBe("2");
  });
});

describe('review: recoloring preserves visibility', () => {
 const sceneFor = (a: Awaited<ReturnType<typeof readAsset>>, colorMap: Record<string,string>): Scene => ({width:400,height:400,title:'',colorMap,layers:[{id:'safe-layer',assetId:a.id,x:200,y:200,scale:1,rotation:0,visible:true,locked:false}]});
 it('keeps mask and filter control paints, including inherited and referenced colors, while recoloring artwork gradients', async()=>{
  const a=await readAsset('<svg viewBox="0 0 30 30" fill="#ffffff" color="#ffffff"><defs><linearGradient id="art"><stop stop-color="#ff0000"/></linearGradient><linearGradient id="maskGradient"><stop stop-color="currentColor"/></linearGradient><mask id="mask"><rect width="30" height="30"/><rect width="20" height="20" fill="#ffffff"/><rect width="15" height="15" fill="url(#maskGradient)"/></mask><filter id="filter"><feFlood flood-color="#ffffff"/></filter></defs><path d="M0 0L20 20" fill="url(#art)" mask="url(#mask)"/></svg>','mask.svg');
  expect(a.colors).not.toContain('#ffffff');
  const out=parse(composeSvg(sceneFor(a,{'#ffffff':'#000000','#ff0000':'#00ff00'}),[a]));
  const effective=(el:Element,key:string):string|null=>el.getAttribute(key)??(el.parentElement?effective(el.parentElement,key):null);
  expect(effective(out.querySelector('mask rect')!,'fill')).toBe('#ffffff');
  expect(out.querySelector('mask rect[fill="#ffffff"]')).not.toBeNull();
  expect(effective(out.querySelector('[id="layer0-maskGradient"] stop')!,'color')).toBe('#ffffff');
  expect(out.querySelector('feFlood')?.getAttribute('flood-color')).toBe('#ffffff');
  expect(out.querySelector('[id="layer0-art"] stop')?.getAttribute('stop-color')).toBe('#00ff00');
 });
 it.each([0,0.5])('retains source rgba alpha %s through map and direct export',async alpha=>{
  const original=`rgba(255,0,0,${alpha})`;const mapped=recolorMap([original],['#00ff00','#0000ff']);expect(mapped[original]).toBe(`rgba(0,255,0,${alpha})`);
  const a=await readAsset(`<svg viewBox="0 0 10 10"><path d="M0 0L4 4" fill="${original}" stroke="${original}"/></svg>`,'rgba.svg');
  for(const map of [mapped,{[original]:'#00ff00'}]){const path=parse(composeSvg(sceneFor(a,map),[a])).querySelector('path')!;expect(path.getAttribute('fill')).toBe(`rgba(0,255,0,${alpha})`);expect(path.getAttribute('stroke')).toBe(`rgba(0,255,0,${alpha})`);}
 });
 it('rejects unsafe layer identifiers at the core boundary',async()=>{const a=await readAsset('<svg viewBox="0 0 10 10"/>','x');const scene=sceneFor(a,{});scene.layers[0].id='"><img src="x" onerror="alert(1)">';expect(()=>composeSvg(scene,[a])).toThrow();});
});

describe('review: inherited structural paint dependencies', () => {
  it.each(['svg', 'g'])('protects gradients referenced by an inherited %s paint without freezing unrelated siblings', async (ancestor) => {
    const definitions = '<defs><linearGradient id="base"><stop stop-color="#ffffff"/></linearGradient><linearGradient id="maskPaint" href="#base"/><linearGradient id="artPaint"><stop stop-color="#ff0000"/></linearGradient></defs>';
    const content = '<mask id="m"><rect width="30" height="30"/></mask><path d="M0 0L20 20" fill="url(#artPaint)" mask="url(#m)"/>';
    const source = ancestor === 'svg'
      ? `<svg viewBox="0 0 30 30" fill="url(#maskPaint)">${definitions}${content}</svg>`
      : `<svg viewBox="0 0 30 30">${definitions}<g fill="url(#maskPaint)">${content}</g></svg>`;
    const asset = await readAsset(source, 'inherited-mask.svg');
    expect(asset.colors).not.toContain('#ffffff');
    expect(asset.colors).toContain('#ff0000');
    const out = parse(composeSvg({width:400,height:400,title:'',colorMap:{'#ffffff':'#000000','#ff0000':'#00ff00'},layers:[{id:'layer',assetId:asset.id,x:200,y:200,scale:1,rotation:0,visible:true,locked:false}]},[asset]));
    expect(out.querySelector('[id="layer0-base"] stop')?.getAttribute('stop-color')).toBe('#ffffff');
    expect(out.querySelector('[id="layer0-maskPaint"]')?.getAttribute('href')).toBe('#layer0-base');
    expect(out.querySelector('[id="layer0-artPaint"] stop')?.getAttribute('stop-color')).toBe('#00ff00');
    expect(out.querySelector('path')?.getAttribute('d')).toBe('M0 0L20 20');
  });
});

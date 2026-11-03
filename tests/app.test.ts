// @vitest-environment jsdom
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { webcrypto } from "node:crypto";
import { mount, validateProject } from "../src/app";
import { composeSvg, readAsset } from "../src/core";
import type { Project } from "../src/storage";
vi.mock("../src/storage", () => ({
  loadProject: vi.fn(async () => undefined),
  saveProject: vi.fn(async () => {}),
}));
const wallet =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><path d="M10 10H150V90H10Z" fill="#c9b4f5" stroke="#111111"/></svg>';
const lamp =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 140"><path d="M10 70L40 10L70 70Z" fill="#eec683" stroke="#111111"/></svg>';
const file = (s: string, name: string) =>
  ({ name, size: s.length, text: async () => s }) as File;
let root: HTMLDivElement;
const button = (id: string) => root.querySelector<HTMLButtonElement>("#" + id)!;
const change = (id: string, value: string) => {
  const input = root.querySelector<HTMLInputElement>("#" + id)!;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
beforeAll(() =>
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  }),
);
beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  vi.useFakeTimers();
});
afterEach(() => {
  root.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("complete editing workflow", () => {
  it("imports once, composes only matching sources, transforms, duplicates and exports editable paths", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([
      file(wallet, "Кошелек.svg"),
      file(wallet, "duplicate.svg"),
      file(lamp, "Лампа.svg"),
    ]);
    expect(editor.getProject().assets).toHaveLength(2);
    root.querySelector<HTMLInputElement>("#prompt")!.value =
      "Финансовая независимость";
    button("compose").click();
    expect(editor.getProject().scene.layers).toHaveLength(1);
    change("layer-x", "220");
    change("layer-scale", "125");
    change("layer-rotation", "30");
    button("duplicate").click();
    const project = editor.getProject();
    expect(project.scene.layers).toHaveLength(2);
    expect(project.scene.layers[0]).toMatchObject({
      x: 220,
      scale: 1.25,
      rotation: 30,
    });
    const svg = new DOMParser().parseFromString(
      composeSvg(project.scene, project.assets),
      "image/svg+xml",
    );
    expect(svg.querySelector("parsererror")).toBeNull();
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(
      "M10 10H150V90H10Z",
    );
    expect(project.assets[0].sourceText).toBe(wallet);
  });
  it("keeps locked objects unchanged, supports undo and redo, and omits hidden layers from SVG", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([file(wallet, "Кошелек.svg")]);
    root.querySelector<HTMLButtonElement>("[data-add]")!.click();
    const before = editor.getProject().scene.layers[0];
    root.querySelector<HTMLButtonElement>("[data-lock]")!.click();
    button("delete-layer").click();
    root
      .querySelector("#canvas-drop")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    expect(editor.getProject().scene.layers[0]).toEqual({
      ...before,
      locked: true,
    });
    root.querySelector<HTMLButtonElement>("[data-visible]")!.click();
    expect(root.querySelectorAll("#stage path")).toHaveLength(0);
    button("undo").click();
    expect(editor.getProject().scene.layers[0].visible).toBe(true);
    button("redo").click();
    expect(editor.getProject().scene.layers[0].visible).toBe(false);
  });
  it("restores the correct canvas format when undoing a size change", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([file(wallet, "Кошелек.svg")]);
    root.querySelector<HTMLButtonElement>("[data-add]")!.click();
    change("canvas-size", "1080x1080");
    button("undo").click();
    expect(editor.getProject().scene.width).toBe(1200);
    expect(root.querySelector<HTMLSelectElement>("#canvas-size")!.value).toBe(
      "1200x630",
    );
  });
  it("shows the actual custom palette color, recolors fills and restores source colors", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([file(wallet, "Кошелек.svg")]);
    root.querySelector<HTMLButtonElement>("[data-add]")!.click();
    const input = root.querySelector<HTMLInputElement>('[data-color="0"]')!;
    input.value = "#ff0000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      input.parentElement!.querySelector("span")!.textContent?.toLowerCase(),
    ).toBe("#ff0000");
    button("apply-palette").click();
    expect(root.querySelector("#stage path")!.getAttribute("fill")).toBe(
      "#ff0000",
    );
    expect(root.querySelector("#stage path")!.getAttribute("stroke")).toBe(
      "#111111",
    );
    button("original-colors").click();
    expect(root.querySelector("#stage path")!.getAttribute("fill")).toBe(
      "#c9b4f5",
    );
  });
  it("does not discard the current composition on an unmatched prompt", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([file(wallet, "Кошелек.svg")]);
    root.querySelector<HTMLButtonElement>("[data-add]")!.click();
    const original = editor.getProject();
    root.querySelector<HTMLInputElement>("#prompt")!.value = "Подводная лодка";
    button("compose").click();
    expect(editor.getProject()).toEqual(original);
  });
  it("rejects unsafe sources without clearing valid imports", async () => {
    const editor = mount(root, { restore: false });
    await editor.importSVG([
      file(wallet, "Кошелек.svg"),
      file('<svg onload="alert(1)"/>', "unsafe.svg"),
    ]);
    expect(editor.getProject().assets).toHaveLength(1);
    expect(root.querySelector("#message")!.textContent).toContain(
      "Не загружено",
    );
  });
});
describe("project portability and validation", () => {
  const project = async (): Promise<Project> => {
    const asset = await readAsset(wallet, "Кошелек.svg");
    return {
      version: 1,
      assets: [asset],
      scene: {
        width: 1200,
        height: 630,
        title: "Тест",
        colorMap: {},
        layers: [
          {
            id: "layer",
            assetId: asset.id,
            x: 600,
            y: 315,
            scale: 1,
            rotation: 0,
            visible: true,
            locked: false,
          },
        ],
      },
    };
  };
  it("validates source bytes again and preserves the original artwork across save/open", async () => {
    const source = await project();
    const restored = await validateProject(JSON.parse(JSON.stringify(source)));
    expect(restored).toEqual(source);
  });
  it("rejects unsafe original bytes even when cached preview is clean", async () => {
    const source = await project();
    source.assets[0].sourceText = "<svg><script/></svg>";
    await expect(validateProject(source)).rejects.toThrow();
  });
  it("rejects string visibility or lock flags rather than silently changing behavior", async () => {
    const source = await project();
    (source.scene.layers[0] as unknown as { visible: string }).visible =
      "false";
    await expect(validateProject(source)).rejects.toThrow();
  });
});

describe('review: unsafe imported layer IDs',()=>{
 const malicious=async():Promise<Project>=>{const asset=await readAsset(wallet,'wallet.svg');return {version:1,assets:[asset],scene:{width:400,height:400,title:'unsafe',colorMap:{},layers:[{id:'"><img src="x" onerror="alert(1)">',assetId:asset.id,x:200,y:200,scale:1,rotation:0,visible:true,locked:false}]}};};
 it('rejects unsafe IDs during project validation',async()=>{await expect(validateProject(await malicious())).rejects.toThrow();});
 it('opens a malicious project without inserting injected markup or handlers',async()=>{const editor=mount(root,{restore:false});const input=root.querySelector<HTMLInputElement>('#project-file')!;Object.defineProperty(input,'files',{value:[file(JSON.stringify(await malicious()),'unsafe.json')]});input.dispatchEvent(new Event('change',{bubbles:true}));await vi.waitFor(()=>expect(root.querySelector('#message')?.textContent).not.toContain('Проверяю'));expect(root.querySelector('img[src="x"],[onerror]')).toBeNull();expect(editor.getProject().scene.layers).toHaveLength(0);expect(root.querySelector('#message')?.textContent).not.toContain('Проект открыт.');});
 it('rejects unsafe IDs on autosave restoration without creating injected nodes',async()=>{const {loadProject}=await import('../src/storage');vi.mocked(loadProject).mockResolvedValueOnce(await malicious());const editor=mount(root);await vi.waitFor(()=>expect(root.querySelector('#save-status')?.textContent).toContain('Автосохранение недоступно'));expect(root.querySelector('img[src="x"],[onerror]')).toBeNull();expect(editor.getProject().scene.layers).toHaveLength(0);});
});

import type { Asset, Scene } from "./types";
export interface Project {
  version: 1;
  assets: Asset[];
  scene: Scene;
}
let db: Promise<IDBDatabase> | undefined;
function database() {
  if (!db)
    db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ochen-vector-workspace", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("projects");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Браузер не разрешает сохранение проекта."));
      request.onblocked = () =>
        reject(new Error("Закройте другую старую вкладку редактора."));
    });
  return db;
}
export async function loadProject(): Promise<unknown> {
  const conn = await database();
  return new Promise((resolve, reject) => {
    const t = conn.transaction("projects", "readonly");
    const r = t.objectStore("projects").get("current");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveProject(project: Project) {
  const conn = await database();
  await new Promise<void>((resolve, reject) => {
    const t = conn.transaction("projects", "readwrite");
    t.objectStore("projects").put(project, "current");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

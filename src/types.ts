export interface Asset {
  id: string;
  name: string;
  tags: string[];
  width: number;
  height: number;
  viewBox: string;
  svg: string;
  colors: string[];
  sourceHash: string;
  sourceText?: string;
}
export interface Layer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
}
export interface Scene {
  width: number;
  height: number;
  title: string;
  layers: Layer[];
  colorMap: Record<string, string>;
}
export type PlanMode = "meaning" | "objects";
export interface CompositionPlan {
  layers: Layer[];
  matches: string[];
  explanation: string;
}

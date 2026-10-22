// Third-person sky and fog palette per biome (presentation only; the fixed views never see the sky).
// `hor` is the colour at the horizon and the fog colour, `zen` the deeper colour overhead; both 0..1 RGB.
export interface SkyDef { hor: [number, number, number]; zen: [number, number, number]; fogNear: number; fogFar: number; fog: number }
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const SKY: Record<string, SkyDef> = {
  meadow: { hor: rgb('#cfe6d2'), zen: rgb('#6fb2e8'), fogNear: 30, fogFar: 130, fog: 0.85 },
  badlands: { hor: rgb('#f0cfa0'), zen: rgb('#d98a62'), fogNear: 26, fogFar: 115, fog: 0.9 },
  frost: { hor: rgb('#e4eef8'), zen: rgb('#9cb8dc'), fogNear: 22, fogFar: 95, fog: 0.95 },
  dusk: { hor: rgb('#4a5a86'), zen: rgb('#141a3a'), fogNear: 20, fogFar: 85, fog: 0.95 },
};
export const skyFor = (biome: string): SkyDef => SKY[biome] ?? SKY.meadow;

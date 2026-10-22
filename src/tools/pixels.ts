// Dev tool: preview the overworld pixel art at 4x.
import { imageToCanvas } from '../overworld/paint';
import * as S from '../overworld/sprites';
import { CAST } from '../overworld/cast';

const root = document.getElementById('root')!;
const show = (img: ImageData | HTMLCanvasElement, label: string, scale = 4) => {
  const c = img instanceof HTMLCanvasElement ? img : imageToCanvas(img);
  c.style.width = c.width * scale + 'px'; c.style.height = c.height * scale + 'px';
  const box = document.createElement('div'); box.className = 'card';
  box.append(c, Object.assign(document.createElement('div'), { textContent: label }));
  root.append(box);
};
for (const [id, p] of Object.entries(CAST)) show(S.personSheet(p).canvas(), id, 3);
show(S.paintTree(0), 'tree'); show(S.paintTree(1), 'tree2'); show(S.paintRoundTree(0), 'round'); show(S.paintRoundTree(2), 'blossom');
show(S.paintBush(1), 'bush'); show(S.paintFlowers('#ff6080', 0), 'flowers'); show(S.paintTallGrass(0), 'tallgrass'); show(S.paintRock(), 'rock');
show(S.paintSign(), 'sign'); show(S.paintLamp(), 'lamp'); show(S.paintMailbox('#e04848'), 'mail'); show(S.paintStoneLantern(), 'lantern');
show(S.paintLog(), 'log'); show(S.paintBench(), 'bench'); show(S.paintFence(), 'fence'); show(S.paintPlanter('#ff80a0'), 'planter');
show(S.paintHedge(), 'hedge'); show(S.paintBerryTree(), 'berry'); show(S.paintWell(), 'well'); show(S.paintGate(), 'gate'); show(S.paintEmote('!'), 'emote');
document.title = 'sheets-ready';

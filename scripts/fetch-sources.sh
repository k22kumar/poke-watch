#!/usr/bin/env bash
# Sparse git checkouts of the three content sources, limited to the Pokémon in content/roster.json:
#   DIR/api-data      PokeAPI/api-data   (static PokéAPI JSON: pokemon, species, evolution chains, moves, types)
#   DIR/spritecollab  PMDCollab/SpriteCollab (sprite/<dex4>/ sheets + AnimData.xml, portrait/<dex4>/Normal.png)
#   DIR/cries         PokeAPI/cries      (cries/pokemon/latest/<id>.ogg)
# usage: scripts/fetch-sources.sh ../src-data   then   node scripts/build-content.mjs --clones ../src-data
set -euo pipefail
DIR=${1:-../src-data}
mkdir -p "$DIR"
NAMES=$(node -e "const r=require('./content/roster.json'); console.log([...r.partners, ...Object.keys(r.wild), ...Object.keys(r.bosses)].join(' '))")
clone() { [ -d "$DIR/$2/.git" ] || git clone -q --depth 1 --filter=blob:none --sparse "https://github.com/$1" "$DIR/$2"; }
clone PokeAPI/api-data api-data
clone PMDCollab/SpriteCollab spritecollab
clone PokeAPI/cries cries
# species ids: resolve names (and first evolutions of partners) through the pokemon-species index
(cd "$DIR/api-data" && git sparse-checkout set --no-cone /data/api/v2/pokemon-species/ /data/api/v2/evolution-chain/ /data/api/v2/type/)
IDS=$(node -e "
const fs=require('fs'),p=require('path'),D='$DIR/api-data/data/api/v2';
const sp={}; for (const d of fs.readdirSync(D+'/pokemon-species')) { const f=p.join(D,'pokemon-species',d,'index.json'); if (fs.existsSync(f)) { const j=JSON.parse(fs.readFileSync(f)); sp[j.name]=j; } }
const r=require('./content/roster.json'); const want=new Set([...r.partners, ...Object.keys(r.wild), ...Object.keys(r.bosses)]);
const depth=r.partnerEvolutions ?? 1;
for (const n of r.partners) { const c=JSON.parse(fs.readFileSync(p.join(D,'evolution-chain',sp[n].evolution_chain.url.split('/').at(-2),'index.json'))).chain; const f=x=>x.species.name===n?x:x.evolves_to.map(f).find(Boolean); let cur=f(c); for (let k=0;k<depth&&cur?.evolves_to?.[0];k++){ cur=cur.evolves_to[0]; want.add(cur.species.name); } }
console.log([...want].map(n=>sp[n].id).join(' '));")
(cd "$DIR/api-data" && git sparse-checkout add $(for i in $IDS; do echo "/data/api/v2/pokemon/$i/"; done))
MOVES=$(node -e "
const fs=require('fs'),D='$DIR/api-data/data/api/v2/pokemon',s=new Set();
for (const d of fs.readdirSync(D)) for (const m of JSON.parse(fs.readFileSync(D+'/'+d+'/index.json')).moves) if (m.version_group_details.some(v=>v.move_learn_method.name==='level-up')) s.add(m.move.url.split('/').at(-2));
console.log([...s].join(' '));")
(cd "$DIR/api-data" && git sparse-checkout add $(for i in $MOVES; do echo "/data/api/v2/move/$i/"; done))
ABIL=$(node -e "
const fs=require('fs'),D='$DIR/api-data/data/api/v2/pokemon',s=new Set();
for (const d of fs.readdirSync(D)) for (const a of JSON.parse(fs.readFileSync(D+'/'+d+'/index.json')).abilities) s.add(a.ability.url.split('/').at(-2));
console.log([...s].join(' '));")
(cd "$DIR/api-data" && git sparse-checkout add $(for i in $ABIL; do echo "/data/api/v2/ability/$i/"; done))
(cd "$DIR/spritecollab" && git sparse-checkout set --no-cone $(for i in $IDS; do d=$(printf %04d "$i"); echo "/sprite/$d/*"; echo "!/sprite/$d/*/"; echo "/portrait/$d/Normal.png"; done) /LICENSE.md /credit_names.txt)
# latest available cry recordings
(cd "$DIR/cries" && git sparse-checkout set --no-cone $(for i in $IDS; do echo "/cries/pokemon/latest/$i.ogg"; done) /LICENSE)
# UI icons: Pokémon type badges and bag icons for the items the game maps upgrades to
clone PokeAPI/sprites sprites
(cd "$DIR/sprites" && git sparse-checkout set --no-cone '/sprites/types/generation-viii/sword-shield/*' $(node -e "console.log(require('./content/icons.json').items.map(i=>'/sprites/items/'+i+'.png').join(' '))" 2>/dev/null || (cd - >/dev/null; node -e "console.log(require('./content/icons.json').items.map(i=>'/sprites/items/'+i+'.png').join(' '))")) /LICENCE.txt)
echo "sources ready in $DIR (species: $(echo $IDS | wc -w), moves: $(echo $MOVES | wc -w))"

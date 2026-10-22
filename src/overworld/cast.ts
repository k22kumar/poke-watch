// Original character cast for the vertical slice (palettes + hairstyles on one body template).
import { SKIN, type Person } from './sprites';

export const CAST: Record<string, Person> = {
  // the player: teal beanie, mustard jacket, charcoal trousers, satchel strap
  player: { skin: SKIN.light, hair: ['#a87858', '#805838', '#5a3c24', '#40281a'], hairStyle: 'short', hat: { ramp: ['#70e0d0', '#38b8a8', '#208878'], kind: 'beanie' }, shirt: ['#ffe8a0', '#f0c858', '#c89a30', '#a07820'], pants: ['#707888', '#505868', '#383e4c'], shoes: ['#f8f8f8', '#d8d8e0', '#9898a8'], bag: ['#e09060', '#b86838', '#8a4a28'] },
  mom: { skin: SKIN.light, hair: ['#b07848', '#8a5830', '#6a4020'], hairStyle: 'bun', shirt: ['#ffd0e0', '#f0a8c0', '#c87898'], pants: ['#9898c8', '#7070a8', '#505088'], shoes: ['#a07050', '#7a5038', '#5a3828'], skirt: true, apron: ['#ffffff', '#f0f0f0', '#c8c8d8'] },
  kid: { skin: SKIN.tan, hair: ['#383848', '#202030', '#101018'], hairStyle: 'spiky', shirt: ['#90e090', '#58c058', '#389838'], pants: ['#f0d080', '#d8b058', '#b08838'], shoes: ['#ff7060', '#d84838', '#a83028'], kid: true },
  girl: { skin: SKIN.light, hair: ['#ffa850', '#e07828', '#b05818'], hairStyle: 'twin', shirt: ['#a8d8ff', '#70b0f0', '#4888d0'], pants: ['#ffffff', '#f0f0f8', '#c8c8e0'], shoes: ['#ff90b0', '#e06088', '#b04068'], skirt: true, kid: true },
  elder: { skin: SKIN.tan, hair: ['#ffffff', '#e0e0e8', '#b8b8c8'], hairStyle: 'bald', shirt: ['#a8a070', '#887e50', '#686038'], pants: ['#6a6058', '#504840', '#383028'], shoes: ['#504038', '#382820', '#201810'], old: true, hat: { ramp: ['#f0e0a0', '#d8c070', '#b09848'], kind: 'straw' } },
  hiker: { skin: SKIN.deep, hair: ['#5a4030', '#3a2818', '#201008'], hairStyle: 'short', hat: { ramp: ['#90c870', '#68a048', '#4a7a30'], kind: 'beanie' }, shirt: ['#f0a050', '#d07828', '#a05818'], pants: ['#a08868', '#806848', '#604a30'], shoes: ['#806040', '#604028', '#402818'], bag: ['#90c870', '#68a048', '#4a7a30'] },
  clerk: { skin: SKIN.light, hair: ['#4a5878', '#303c58', '#1c2438'], hairStyle: 'bob', shirt: ['#ffffff', '#f0f0f8', '#c8c8e0'], pants: ['#506090', '#384878', '#283458'], shoes: ['#383840', '#202028', '#101018'], apron: ['#88d8b0', '#58b888', '#389868'] },
  fisher: { skin: SKIN.tan, hair: ['#383030', '#201818', '#100808'], hairStyle: 'short', hat: { ramp: ['#ffffff', '#e8e8f0', '#b8b8c8'], kind: 'cap' }, shirt: ['#6898d8', '#4878b8', '#305898'], pants: ['#787058', '#585038', '#403820'], shoes: ['#a0a0a8', '#787880', '#505058'] },
  lady: { skin: SKIN.deep, hair: ['#383040', '#201828', '#100810'], hairStyle: 'long', shirt: ['#f8e070', '#e8c040', '#c09820'], pants: ['#e86868', '#c84848', '#983030'], shoes: ['#f8f8f8', '#d8d8e0', '#a8a8b8'], skirt: true },
  keeper: { skin: SKIN.light, hair: ['#d8d8e0', '#b0b0c0', '#8888a0'], hairStyle: 'short', shirt: ['#ffffff', '#f0f0f0', '#d0d0d8'], pants: ['#e85050', '#c03030', '#902020'], shoes: ['#a07050', '#7a5038', '#5a3828'], old: true, skirt: true },
};

# Music slots

Poke-Watch ships original music (see `docs/AUDIO.md`). If you have recordings you are entitled to use, they can replace any music state without code changes:

```json
{
  "slots": {
    "route_meadow": { "file": "route-meadow.ogg", "loopStart": 2.384, "loopEnd": 65.112, "gain": 0.9, "title": "…", "source": "…", "license": "…" },
    "battle":       { "file": "battle.ogg",       "loopStart": 1.6,   "loopEnd": 0 },
    "victory":      { "file": "victory.ogg" }
  }
}
```

States: `title`, `route_meadow`, `route_badlands`, `route_frost`, `route_dusk`, `battle`, `boss`, `evolution`, and the one-shot stingers `evolved`, `victory`, `defeat`, `item`.

`npm run content` embeds every listed file into `src/content/music.json`. Loops use the Web Audio buffer loop with these points, so they are gapless; OGG/MP3/WAV all work (MP3 adds encoder padding at the start, so measure loop points on the decoded audio).

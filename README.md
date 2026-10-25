# 🐟 Fish Hunt

A two-player 3D hide-and-seek game set in a pastel coral reef, with guns, bullets, and hungry shark NPCs. Peer-to-peer, no server, runs on GitHub Pages.

**Play:** open the site, one player clicks **Host a game** and shares the 4-letter room code (or the link), the other enters the code and clicks **Join**.

## How a round works

1. **Hide** (30 s) — the hider swims off into the reef while the seeker's screen is blindfolded.
2. **Seek** (100 s) — the seeker hunts. Land **3 shots** on the hider or tag them with **E** to win the round. In the last 30 seconds the seeker gets a sense arrow toward the hider.
3. Roles swap and the score carries over.

Meanwhile three **sharks** patrol the reef and chase any fish they spot. A bite takes 20 health; at 0 you are eaten and respawn at your start (and if you were the hider, the seeker gets pointed at you). Three bullets kill a shark, which respawns elsewhere later. The hider's shots **ink** the seeker's view and slow them for a moment.

## Controls

| Key | Action |
| --- | --- |
| W A S D | swim (relative to the camera) |
| Space / C | swim up / down |
| Mouse (click canvas to lock) | look and aim |
| Left click / F | shoot |
| Shift | dash |
| E | tag the hider (seeker, within reach) |
| Scroll | zoom camera |

Hiding spots: kelp forests (swim right in), two caves, the shipwreck hull, under table coral, behind rock pillars, inside the arch.

## Tech

- [Three.js](https://threejs.org) rendering, procedural fish/shark models, swept-AABB physics in 3D.
- Peer-to-peer multiplayer over WebRTC with [PeerJS](https://peerjs.com). The host's browser runs the authoritative game logic (rounds, damage, shark AI); the public PeerJS cloud only introduces the two browsers.
- Pure static site — no build step. Serve the folder with any static file server, e.g. `python3 -m http.server`.

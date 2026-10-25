# 🐟 Fish Hunt

A two-player 3D hide-and-seek game set in a pastel coral reef, with guns, bullets, flares, ink clouds, sonar, and LeBron James patrolling the reef. Peer-to-peer, no server, runs on GitHub Pages.

**Play:** open the site, one player clicks **Host a game** and shares the 4-letter room code (or the link), the other enters the code and clicks **Join**.

## How a round works

1. **Hide** (10 s) — the hider swims off into the reef while the seeker's screen is blindfolded.
2. **Seek** (100 s) — the seeker hunts. Land **3 shots** on the hider or tag them with **E** to win the round. In the last 30 seconds the seeker gets a sense arrow toward the hider.
3. Roles swap and the score carries over.

Meanwhile four **LeBrons** swim laps around the reef and dunk on any fish they spot. When he gets within a few meters he lunges. A dunk takes 30 health; at 0 you are posterized and respawn at your start (and if you were the hider, the seeker gets pointed at you). Five bullets send a LeBron to the bench, and he respawns elsewhere later. The hider's shots **ink** the seeker's view and slow them for a moment. The seeker's gun fires slower than the hider's, and LeBron holds a mild grudge: he spots the seeker from a little farther away and prefers them when both fish are about as close.

## Abilities and pickups

| Key | Who | Effect | Cooldown |
| --- | --- | --- | --- |
| **Q** flare | both | Tosses a burning flare ahead of you. Every LeBron within 34 m drops what he's doing and circles it for 12 s. | 15 s |
| **R** ink cloud | hider | Drops a 9 m black cloud around you. Opaque from the outside, see-through for you. | 20 s |
| **R** sonar | seeker | Pings the hider: a 2.5 s arrow with the distance. The hider is warned they were pinged. | 15 s |
| **T** net | seeker | Fires a slow, wide net. On a hit the hider is tangled for 3 s: barely able to move and unable to ink. | 18 s |
| **G** torpedo | seeker | A 0.8 s dash at 24 m/s in the aim direction. | 10 s |
| **V** whistle | seeker | Calls LeBron to the hider's current position for 7 s. The hider hears the whistle. | 30 s |
| 🫧 pearls | both | Eight glowing pearls around the reef. Swim through one for +50 health and a 6 s speed boost. Respawns after 30 s. | — |

## Controls

| Key | Action |
| --- | --- |
| W A S D | swim (relative to the camera) |
| Space / C | swim up / down |
| Mouse (click canvas to lock) | look and aim |
| Left click / F | shoot (over-the-shoulder crosshair, turns red on a target) |
| Q | flare |
| R | ink cloud (hider) / sonar ping (seeker) |
| T / G / V | net / torpedo / whistle (seeker) |
| Shift | sprint burst (about 1.5 s at nearly double speed, refills in 4 s) |
| E | tag the hider (seeker, within reach) |
| Scroll | zoom camera |

Hiding spots: kelp forests and seagrass meadows (swim right in), three caves, the shipwreck hull, two open pipes, giant clams, under upturned rowboats, between barrels, under table coral, behind rock pillars, inside the arch.

## Tech

- [Three.js](https://threejs.org) rendering, procedural fish and LeBron models, swept-AABB physics in 3D.
- Peer-to-peer multiplayer over WebRTC with [PeerJS](https://peerjs.com). The host's browser runs the authoritative game logic (rounds, damage, LeBron AI, flares, pearls); the public PeerJS cloud only introduces the two browsers.
- Pure static site — no build step. Serve the folder with any static file server, e.g. `python3 -m http.server`.

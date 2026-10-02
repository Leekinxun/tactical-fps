# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-02
- Primary product surfaces: 3D match scene, tactical HUD, briefing/lobby, buy menu, pause and result overlays.
- Evidence reviewed: `README.md`, `src/game/world/createArena.ts`, `src/game/render/RendererFactory.ts`, `src/game/render/ViewWeapon.ts`, `src/game/render/viewmodel/HandSkin.ts`, `src/game/render/viewmodel/TacticalHands.ts`, `src/game/characters/SkinnedOperator.ts`, `src/app/App.ts`, `src/styles.css`, `public/og.png`.

## Brand
- Personality: grounded near-future tactical realism; disciplined, utilitarian, tense, readable.
- Trust signals: plausible construction, physically motivated light, restrained military UI, consistent team identification.
- Avoid: flat greybox materials, neon sci-fi glow, toy-like primary colors, oversized arcade HUD, excessive bloom, visual noise that obscures targets.

## Product goals
- Goals: make the arena read as a believable industrial training compound while keeping competitive silhouettes and navigation clear.
- Non-goals: photoreal AAA asset density, gore, licensed military brands, destructible scenery, cinematic post-processing that harms aim clarity.
- Success signals: surfaces have visible material identity and scale; foreground/midground/background separate clearly; players can identify cover, lanes, teams, and interactables at a glance.

## Personas and jobs
- Primary personas: desktop FPS players using mouse and keyboard; small LAN groups.
- User jobs: orient quickly, identify friend/foe, read cover and elevation, track match state without leaving the crosshair.
- Key contexts of use: 16:9 desktop displays, motion-heavy first-person play, WebGPU or WebGL2 browsers.

## Information architecture
- Primary navigation: briefing → mode/lobby → buy phase → live round → round/match result.
- Core routes/screens: single-page canvas with layered overlays.
- Content hierarchy: crosshair and threats first; health/ammo second; objective/score third; backend/debug metadata last.

## Design principles
- Material before decoration: concrete, painted steel, rubber, hazard paint, glass, and emissive fixtures must react differently to light.
- Tactical clarity over cinematic darkness: shadows add depth, but playable paths and targets remain legible.
- Believable repetition: modular panels, seams, stains, barriers, pipes, lights, and signage establish scale without random clutter.
- Architecture: volumes must read as buildings with plinths, roof edges, doors, windows and services. Avoid decorating a freestanding wall and presenting it as a factory.
- Materials: use physically scaled UVs and albedo colors in linear space. Generated asphalt and ivory concrete images are recorded in `public/textures/materials/README.md`.
- Lighting: directional daylight, restrained sky fill, PCF shadow filtering, half-resolution ambient occlusion and FXAA. Shader code for WebGL2 and WebGPU must be loaded before material readiness is announced.

## Visual language
- Color: desaturated concrete and gunmetal; warm sodium work lights against cool ambient sky; amber hazard accents; muted green/brick team colors.
- Typography: condensed operational headings and compact monospaced telemetry; Chinese remains highly legible.
- Spacing/layout rhythm: 4/8/12/16/24/32 px; HUD elements stay near edges and preserve the central sight picture.
- Shape/radius/elevation: squared plates, clipped corners, 0–3 px radii, thin borders, restrained shadows and blur.
- Motion: fast 120–220 ms HUD feedback; subtle environmental flicker only; honor reduced motion.
- Imagery/iconography: stencil markings, bay numbers, caution bands, utility symbols; no decorative fantasy glyphs.

## Components
- Existing components to reuse: score strip, objective block, vitals, ammo, lobby, buy grid, pause/result panels.
- New/changed components: environmental PBR material set, modular light fixtures, floor markings, pipes/ducts, barriers, decals/signage, atmosphere pipeline, compact HUD surfaces.
- Variants and states: friendly green, enemy rust-red, neutral amber, warning yellow; BUY/LIVE/ROUND_END/MATCH_END remain distinct.
- Token/component ownership: CSS tokens in `src/styles.css`; 3D palette/material construction in `src/game/world/createArena.ts`.

## Accessibility
- Target standard: WCAG AA for overlays where practical; gameplay contrast optimized for fast recognition.
- Keyboard/focus behavior: preserve current keyboard controls and visible focus rings.
- Contrast/readability: text uses opaque scrims; team colors are reinforced by labels and values, not color alone.
- Screen-reader semantics: retain labeled canvas and live combat/status regions.
- Reduced motion and sensory considerations: retain `prefers-reduced-motion`; avoid strong flashes and high-intensity bloom.

## Responsive behavior
- Supported breakpoints/devices: modern desktop browsers; compact layout below 800 px remains a fallback, not a touch-first game mode.
- Layout adaptations: reduce HUD widths and hide backend metadata before shrinking primary combat information.
- Touch/hover differences: no touch gameplay promise; interactive overlays remain usable without hover-only state.

## Interaction states
- Loading: dark equipment-bay presentation with clear progress.
- Empty: lobby explains mixed-squad fill behavior.
- Error: centered high-contrast diagnostic panel.
- Success: result state preserves final score and rematch action.
- Disabled: reduced opacity plus explicit lock/owned/insufficient-funds copy.
- Offline/slow network: visible room, team, and connection status; reconnect pause blocks input safely.

## Content voice
- Tone: concise operational Chinese with restrained English identifiers.
- Terminology: ALPHA, BRAVO, BUY, LIVE, Bot, 回合, 混编小队.
- Microcopy rules: state consequence first; avoid marketing language during live combat.

## Implementation constraints
- Framework/styling system: Babylon.js scene code and repository-native CSS; no new UI or 3D dependencies.
- Design-token constraints: extend existing CSS variables rather than adding a parallel theme layer.
- Performance constraints: procedural textures remain small; shadow casters and dynamic lights are bounded; WebGL2 remains supported.
- Compatibility constraints: building footprints live in shared `ARENA_BOXES`; client geometry, authoritative server collision and radar must agree. Decorations stay outside playable volume or above player reach. Spawn points and navigation graph edges must stay clear.
- Test/screenshot expectations: lint, typecheck, unit/integration tests, production build, and 1440×900 screenshots of briefing plus live scene.

## Visual review and known gaps
- Daylight reflection uses a filterable RGBA8 cube map. Do not reintroduce float32 panorama cube mipmaps without checking WebGPU devices lacking float filtering; this caused black PBR materials in the real browser.
- 3D review captures: `.omx/visual-review/3d-rifle-idle.png`, `3d-rifle-shot.png`, `3d-operator.png`.
- Saved real gameplay captures: `.omx/visual-review/before-industrial-yard.png`, `after-industrial-yard.png`, `a-yard.png`, `b-yard.png`.
- Reproducible development views: start solo with `?review=a-yard` or `?review=b-yard`; these camera placements are excluded from production builds.
- First-person weapons now render as depth-cleared 3D meshes with weighted tactical hands, muzzle-attached effects, slide/bolt recoil and contact-based magazine reload phases. PX-9, VX-7, RIFT-6 and Needle .50 use locally authored Blender mesh packages; ARC-12 and BR-4 use CC0 source meshes. Buy-menu thumbnails remain raster art.
- First-person hands use `public/models/weighted-hands/weighted-hands.json`, generated from `assets/blender/weighted-hands/weighted-tactical-hands.blend` by `scripts/blender/build_weighted_hands.py`. Each hand has 16 bones, normalized four-slot skin weights, open/grip local poses and a palm contact point used by the reload animation.
- Local bots and remote players share `public/models/skinned-operator/operator.json`, generated from `assets/blender/skinned-operator/operator.blend` by `scripts/blender/build_skinned_operator.py`. The visible operator is an 18-bone GPU-skinned Skeleton with world-space foot anchors, two-bone limb IK, crouch lowering and procedural aim/recoil. Non-pickable visual geometry stays separate from the original hit proxies.
- Source/license records: `public/models/skinned-operator/LICENSE.CC0.md`, `public/models/skinned-operator/manifest.json`, `public/models/skinned-operator/validation.json`, `public/models/weighted-hands/LICENSE.ASSETS.md`, `public/models/weighted-hands/manifest.json`, and the package overview in `public/models/README.md`.
- This remains an industrial FPS prototype; passing functional checks does not establish visual parity with CS2.

## Open questions
- [ ] Remaining quality gap: professionally authored cloth/face detail, motion-captured animation clips, and deeper environment asset density. The current MakeHuman-derived body/hands use real GPU skinning but the runtime motion is still procedural IK and keyframed contact logic.
- [ ] Audio direction: environmental machinery, distant ventilation, and material-specific footsteps are not part of this visual pass.

## K-7 expansion · 2026-10-02
- Playable bounds: 128×144m; area 18,432m² (2.304× baseline). Asymmetric open A reactor yard and covered B loading hall; three usable B entries; mid and fallback rotation routes.
- Shared map data remains authoritative for server/client collision, objectives, spawn slots, tactical graph and radar. Render-only warehouse roofing is above all playable paths. No unsupported upper-floor gameplay is claimed.
- Map art derives perimeter positions and UV repetition from ARENA_BOUNDS. Opaque decoration batches are grouped by material and shadow-caster role, independent of collision meshes.
- Pace gates: ten server bots reach both sites within a round; solo attacking bots can reach B within 50s; cover blocks sight and movement; both sites remain reachable after a choke is removed.
- Long Recast paths use a larger point budget; incomplete returned paths fall back to the tactical graph.
- Motion: idle feet keep a stable pose; movement weight eases in/out, world foot anchors resist sliding, crouch lowers the skinned body through IK, and short firing impulses settle exponentially.
- Visual reference: Valve's Dust II art notes (https://www.counter-strike.net/dust2) emphasize visibility and lighting. Our dimensions and timing targets are project decisions, not claims about CS2 official dimensions.

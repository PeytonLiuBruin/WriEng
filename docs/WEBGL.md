# Interactive journey map

The journey page now renders a real Three.js **WebGL 2** scene. The home illustration and fallback remain SVG; they are labelled as a two-dimensional map. No external textures, models, asset CDN or AI images are used. Every building, plant, bridge, eye, boot, envelope and boat is original procedural geometry in `src/WorldScene.ts`.

The scene contains four connected islands: the post office, recall bridge, day-after garden and memory lighthouse. The original frog postie 阿忆 has an envelope hat and an oversized parcel satchel. Soft hemisphere/fill lighting, one directional shadow, rough materials and low-poly shapes give physical depth. Station completion comes from the app's actual study-event evidence; map progress does not assert permanent mastery.

## Interaction and accessibility

- Drag or one-finger orbit; wheel or two-finger zoom. Zoom buttons and reset are also available.
- Click an island or its projected DOM sign to select it. All four stations also have persistent native HTML buttons; the selected state is reflected in both menus using `aria-pressed`. Details update in a polite live region.
- The Three scene loads only after entering the journey page. The app unmounts it completely during recall and handwriting.
- Manual 2D preference is saved separately from learning progress. App/system reduced-motion requests force the static map. Devices exposing ≤2 CPU threads or ≤2 GB memory initially receive the lightweight map and can opt into 3D.
- Missing WebGL 2 and a lost graphics context switch to the SVG map with a plain explanation. Station controls remain available. This does not reset IndexedDB study data.

## Rendering and disposal

There is no permanent animation loop and no idle camera motion. Control changes, resize, visibility restoration and selection request a frame. Selection feedback lasts 480 ms; rendering submissions are throttled to at most 30 per second. The scene pauses when the document is hidden or the stage is outside the viewport. The phone DPR ceiling is 1.5; desktop ceiling is 1.75. A single shadow map is 512² on initial narrow layout and 1024² otherwise. No postprocessing, realtime ocean simulation or fullscreen bloom is used.

Static geometry is merged by material to avoid a separate draw for every flower petal, eye or roof part. A Windows Chrome local-development probe at 1440 × 1000 reported **39 render calls and 21,536 triangles**; after initial setup, the frame counter stopped at 2 with the camera idle. These are measured desktop values, not a phone benchmark. The implementation exposes frame count, render calls, triangle count, paused state, camera and DPR on the canvas for browser QA. On unmount, it cancels pending frames/timeouts, removes observers/listeners, disposes controls/geometries/materials/shadow/render lists/renderer, releases the graphics context and removes the canvas.

## Dependencies and verification

Three.js `0.186.1` and `@types/three` `0.186.0` are installed from the npm registry; both packages retain their respective licence files in dependencies. Rendering APIs follow the official [WebGLRenderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html) and [OrbitControls documentation](https://threejs.org/docs/pages/OrbitControls.html). Three.js is MIT licensed; no third-party art licence is required for this scene.

Component tests cover reduced motion, lifecycle disposal, equivalent station controls, stored 2D preference, unchanged evidence arrays, context-loss fallback and unavailable WebGL. Browser tests own actual rendering, drag/zoom, mobile bounds, offline route restoration and context loss; see `tests/webgl.spec.ts` and the final test report for results. Mocked unit tests alone do not establish WebGL support.

Refined visual evidence: `screenshots-v2/early-map.png`, `screenshots-v2/early-map-mobile.png`. The default camera was moved closer after inspecting the first captures, with all four signs kept apart on desktop and phone layouts. These are real captures from an isolated session of the installed Windows Chrome binary against the local development server. The user's personal browser profile and unrelated tabs were not accessed.

Limitations: this is a small interactive diorama, not a navigable 3D game world. The static fallback provides the same evidence and station selection. No GPU performance claim is made for untested physical phones; devices that struggle can switch to 2D.

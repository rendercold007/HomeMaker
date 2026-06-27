

6/25/26, 12:51 PM 

## AI Brain Framework & Engine Integration 

Objective: Transition the manual 2D/3D React + Three.js application into an AI-powered design assistant. This phase builds the asynchronous backend responsible for receiving room dimensions, querying LLMs for design intent, matching 3D assets, and calculating precise 3D collision-free coordinates. 

## 1. System Architecture Diagram 

## graph TD 

A[React/Zustand Frontend] -->|POST /api/generate-room| B(Node.js API Gatewa 

B -->|Task Payload| C(Python FastAPI Worker) 

C -->|1. Intent Prompt| D[LLM: Claude 3.5 / GPT-4o] 

D -->|JSON Shopping List| C 

C -->|2. Semantic Search| E[(Vector DB - Pinecone/pgvector)] 

E -->|Asset Metadata + Dimensions| C 

C -->|3. Spatial Solver & Math| C 

C -->|JSON: [X,Y,Z] Coordinates| B 

B -->|WebSocket / HTTP Response| A 

A -->|State Update| F[Three.js GLTFLoader] 

## 2. The Step-by-Step Implementation Pipeline 

## Step 4.1: API Gateway (The Traffic Cop) 

Tech Stack: Node.js, Express (or Next.js API Routes), PostgreSQL. 

- Role: Acts as the primary interface for the frontend. It handles authentication, project 

- saving/loading, and routes heavy AI generation tasks to the Python worker so the Node main thread doesn't block. 

- Endpoint: POST /api/design/auto-furnish 

- Payload from Frontend: 

{ "prompt": "Create a cozy modern reading nook", "room": { "dimensions": {"width": 4.0, "length": 5.0, "height": 2.8}, "doors": [{"position": [0, 2.5], "width": 0.9}], "windows": [{"position": [4.0, 1.5], "width": 1.2}] } } 

## Step 4.2: Intent Extraction (The LLM Layer) 

https://gemini.google.com/u/1/app/c2dfd59f7952a0e2?pageId=none 

1/3 

Building a Home Design Tool - Google Gemini 

6/25/26, 12:51 PM 

- Tech Stack: Python, FastAPI, Anthropic API (Claude) or OpenAI API. 

- Role: LLMs are terrible at 3D math, so we only use them for reasoning and styling. The Python worker sends the room config and user prompt to the LLM with a strict system prompt. 

- Expected Output from LLM: A structural "shopping list" with spatial rules, NOT exact coordinates. 

{ "items": [ {"type": "lounge_chair", "style": "modern", "rule": "near_window"}, {"type": "floor_lamp", "style": "warm", "rule": "next_to_chair"}, {"type": "bookshelf", "style": "wood", "rule": "against_solid_wall"} ] } 

## Step 4.3: Semantic Search (The Vector Database) 

- Tech Stack: Pinecone, Weaviate, or PostgreSQL + pgvector . 

- Role: We need to map the LLM's generic "lounge_chair" to a real .glb 3D model in our catalog. 

- Action: Generate a text embedding for "modern lounge chair" and query the Vector DB. The database returns the closest matching asset's metadata, crucially including its physical dimensions (Bounding Box). 

## Returned Metadata: 

{ "asset_id": "glb_chair_mod_001", "url": "[https://cdn.yourapp.com/assets/glb_chair_mod_001.glb](https://cdn "dimensions": {"width": 0.8, "depth": 0.85, "height": 0.9} 

} 

## Step 4.4: The Spatial Solver Engine (Deterministic Math) 

- Tech Stack: Python (Custom Constraint Satisfaction Algorithm). 

- Role: This is the most critical component. It takes the dimensions of the room, the locations of doors/windows, and the dimensions of the chosen furniture, and calculates collision-free [X, Y, Z] coordinates. 

## Algorithm Logic: 

1. Grid Generation: Divide the room into a 2D grid (e.g., 10cm cells). 

2. Obstacle Marking: Mark cells near the door (swing path) as impassable. 

3. Placement & Collision Check: For each item, look at its rule (e.g., "near_window"). Scan grid cells near the window. Check if a bounding box of 0.8 x 0.85 fits without hitting a wall or the door path. 

expand 

tune 

https://gemini.google.com/u/1/app/c2dfd59f7952a0e2?pageId=none 

2/3 

Building a Home Design Tool - Google Gemini 

6/25/26, 12:51 PM 

chat_spark 

4. Lock Coordinates: Once a valid spot is found, save the precise [X, Y, Z] and rotation . Update the grid to mark those cells as occupied so the next item (e.g., the 

lamp) doesn't spawn inside the chair. 

## Step 4.5: Frontend Hydration 

- Role: The Python worker bundles the calculated coordinates and sends them back to the frontend. 

Final Payload back to React: 

{ "generated_furniture": [ { "asset_id": "glb_chair_mod_001", "position": [3.2, 0, 1.5], "rotation": [0, 45, 0] }, { "asset_id": "glb_lamp_02", "position": [3.8, 0, 1.2], "rotation": [0, 0, 0] } ] } 

Client Action: React receives this JSON, updates the Zustand global store. Three.js 

- GLTFLoader detects the new array items, fetches the .glb files, and renders them at the 

- exact coordinates. 

## 3. Recommended Development Order for Phase 4 

1. Mock the Pipeline: Don't use AI yet. Write a Node endpoint that simply returns a hardcoded JSON payload with 1 bed and 1 dresser. Ensure your frontend properly receives it and Three.js renders it. 

2. Build the Spatial Math: Write the Python script that calculates bounding box collisions. Feed it fake furniture dimensions and ensure it spits out valid, non-overlapping coordinates. 

3. Connect the LLM: Once the math is solid, wire up the Anthropic/OpenAI API to dynamically generate the shopping lists. 

4. Wire up the DB: Finally, add the Vector database to dynamically source the real .glb asset links. 

### Status — real 3D assets (Tier 2 #4), frontend-first

The frontend half of step 4 is built **without** the vector DB. Rather than the
worker resolving `type → asset_id`, the 3D view maps `furniture.type → .glb`
directly and loads it with drei `useGLTF`, auto-fitting each model to its catalog
footprint and resting it on the floor (`computeFitTransform`). Missing or broken
models fall back to the hand-built procedural mesh (`FurnitureMesh`) through a
`<Suspense>` + error boundary, so the scene never breaks. Models are
**auto-discovered**: any `<type>.glb` dropped into `src/assets/models/` is wired
up by an `import.meta.glob` in `furnitureAssets.ts` — no list to maintain, and
types without a file render procedurally with no network request (no 404s).
Per-model corrections (orientation, fixed scale, wall-mounting) go in the small
`ASSET_OVERRIDES` map. See `src/assets/models/README.md`.

The vector DB stays deferred: it only earns its keep once the LLM emits
free-text item names outside the fixed catalog. Today the worker emits canonical
catalog `type`s, so a static manifest covers the visual win. When off-catalog
items appear, add the worker-side embedding lookup to resolve them to a `type`
(or directly to an asset) and the same frontend loader renders the result.

### Status — entrance-aware layout (Tier 2 #5, step 1)

`generate_plan` now respects the **entrance side**. The LLM extracts it from the
prompt as pure intent — `build_room_program_prompt` asks for an optional
top-level `"entrance": "N|S|E|W"` alongside the room list, and
`parse_room_program` surfaces it on a `RoomProgram` (rooms + entrance).
`generate_plan(plot, rooms, entrance=…)` then (a) places the front door on an
exterior wall of that side — preferring a public room (living/dining) there and
the longest such wall — and (b) floats public rooms toward that side in the BSP
order (`_bias_for_entrance`: front of the list for N/W, back for E/S). The bias
is a best-effort tendency, not a guarantee; the **door placement is exact**.
`entrance=None` is byte-identical to the prior behaviour (no regression). The
side comes from the prompt; `app.py` also accepts an explicit `plot.entrance`
as a fallback if the frontend sends one. Coordinates remain 100% deterministic —
the LLM only names the side.

### Status — circulation / hallways (Tier 2 #5, step 2)

Once a plan has enough rooms (`MIN_ROOMS_FOR_CORRIDOR`, currently 4),
`generate_plan` carves a **straight spine corridor** instead of butting every
room against its neighbours, so rooms open onto a hallway rather than onto each
other (no more shotgun/railroad layouts). `layout_with_corridor` runs the spine
perpendicular to the entrance wall so it reaches the front door — a N/S entrance
gives a vertical full-height spine, an E/W entrance a horizontal full-width one;
with no entrance it follows the longer axis. Rooms are weight-split onto the two
sides and each side is laid out by the existing `bsp_layout`, so the plot still
tiles exactly and the wall graph stays planar (Euler's `faces = E - V + 1` still
equals rooms + 1). In `place_openings` the corridor is the connectivity **hub**:
the spanning tree prefers corridor edges first (rooms hang off the hall), the
front door opens into the corridor on the requested side, and the `hallway`
"room" has no furniture template so it stays clear. `entrance=None` / fewer than
the threshold rooms keep the prior direct-connection behaviour.

### Status — L-shape / irregular envelopes (Tier 2 #5, step 3)

`generate_plan` now respects an **L-shaped footprint**. Like the entrance, the
shape is pure intent: the LLM extracts an optional `"shape": "rectangular|lshape"`
from the prompt (`normalize_shape` also maps "irregular" → lshape), and `app.py`
falls back to an explicit `plot.shape`. When the shape is `lshape` (and there are
≥2 rooms), `lshape_layout` lays the rooms into the bounding box **minus a corner
notch**: the L splits cleanly into two rectangles (a full-length wing + a shorter
block beside the notch), rooms are divided between them by area, and each is laid
out by the existing `bsp_layout`. The two wings tile the L exactly, so the
shape-agnostic `build_graph` produces a planar wall graph with the notch as
exterior (Euler's `faces = E - V + 1` still equals the room count, verified for
all four notch corners — no diagonal walls). The notch corner is chosen to avoid
the entrance wall (`notch_corner`), so the front of the house stays a full wing,
and the front door + furniture placement (both already shape-agnostic) work
unchanged.

Known v1 limits: the L and the spine corridor don't compose yet (an `lshape`
plan skips the corridor — its wings already break the footprint up), and
"irregular" is approximated by a single L. Both are future refinements.

Tier 2 #5 (smarter layout) is now complete: entrance-aware → circulation →
L-shape.

### Status — wall joins & mitering (Tier 2 #6)

Done (frontend, pure logic in `src/model/miter.ts`). A wall is a centreline
segment with a thickness; rendered naively, two walls meeting at a vertex overlap
on the inside and leave a triangular notch outside. `computeWallQuads` replaces
each wall end's square butt with the true miter — the intersection of its side
edge with its angular neighbour's facing edge at the shared vertex — and returns
one four-corner quad per wall. `wallEdgePoint` reads a point on either offset
edge (mitered ends, square cuts at openings); **both renderers share it**, so the
2D fill (`WallsLayer`) and the 3D extrusion (`WallMesh`/`Viewer3D`) agree exactly.
Free ends butt square; collinear runs stay seamless; acute spikes are clamped to a
butt past `MITER_LIMIT` (6× half-thickness). L-corners and **T-junctions** (the
dominant case — BSP offsets its splits into Ts, never 4-way crosses) miter with no
gap or overlap, verified in `src/model/miter.test.ts`.

Known limit: an exact **4-way cross** (four arms at one point) leaves a small
centre-square gap. BSP layouts never produce one, so it is only reachable by a
hand-drawn wall; filling it is a future refinement.

That closes Tier 2. Next is **Tier 3** — persistence/accounts, export polish
(PNG/PDF → DXF), then latency/cost (`docs/CLAUDE.md` Phase 6). 

https://gemini.google.com/u/1/app/c2dfd59f7952a0e2?pageId=none 

3/3 


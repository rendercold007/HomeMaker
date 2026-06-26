

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

https://gemini.google.com/u/1/app/c2dfd59f7952a0e2?pageId=none 

3/3 


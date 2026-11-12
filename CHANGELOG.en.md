# Changelog (English)

Release notes in English. The Chinese notes are in [CHANGELOG.md](./CHANGELOG.md); both are updated together for every release. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

From 1.0.0-rc.9 on, every entry is a full translation of the Chinese one. Earlier versions are summarised under [Earlier versions](#earlier-versions-summary).

## [1.0.0-rc.17] — 2026-11-12 (release candidate, code complete, not tagged)

"Timeline and groups": cutting several shots into one film no longer means ordering them by moving nodes around, and a big canvas can be organised into groups by scene, run a group at a time, and saved as your own templates. The batch node changes how nodes run (one run per node), so it moves to rc.18 together with review mode.

### Added
- **Timeline** (the 「时间线」 button on the export node): lists every clip wired into the 视频 port, with thumbnails and durations.
  - Drag rows, or use ↑ ↓, to reorder. Once saved, the node shows 「已排序」; clips wired in later follow in canvas order.
  - Each clip can have an **in / out point** in seconds; empty means from the start / to the end. The list shows the full length and the length used, and draws the used span.
  - **Preview**: plays the trimmed part of every clip in order, to check the pacing.
  - Order and trims are stored per source node (`params.order` / `params.trims`), so they survive re-generating a shot.
  - The exported film, its soft subtitles and the editor project all follow the timeline; in Shotcut each clip starts at its in point. Voice-overs in the same row as a clip move with it.
- **Groups**: select nodes and press `Ctrl/⌘ G` (or right-click → 分组). A named frame appears, drawn behind the nodes.
  - Drag the title bar to move the whole group. When selected, drag the corners to resize. Double-click the title to rename.
  - The frame's empty area doesn't block clicks, so wiring and box-selecting work as before.
  - The title bar and context menu offer **run this group**, **save as template** and **ungroup** (`Ctrl/⌘ Shift G`; the nodes stay).
  - Groups can be copied, pasted and undone, and are saved with the canvas and exported in project bundles. A group never runs and isn't counted in cost estimates.
- **My templates**: keeps a group's nodes, params, model choices and wires (not results) in this browser. Search its name under `/` to insert a fresh copy.
- **Agents (MCP)**:
  - new `group_nodes` tool (e.g. one group per scene);
  - `get_canvas` lists the nodes inside each group;
  - `update_node` can set an export node's timeline.

### Changed
- On macOS the app is now named `HaizhuInfinityCanvas.app`; rc.16 used `haizhu-infinity-canvas.app`. Windows and Linux keep their executable names and install paths, so commands already added to Claude Code still work.
- Roadmap: rc.18 "batch and review", rc.19 "consistency", rc.20 "assistant and apps".
- New E2E suite timeline-flow; CI now runs eighteen E2E suites.

### Verified
- Locally: typecheck passes; 230 unit / integration tests (core 43, server 187). New tests:
  - Timeline order: listed clips first, and several clips from one node stay together.
  - In / out points are checked and capped, and the used span never runs past the clip.
  - Export with red / blue test videos made by FFmpeg: the timeline puts the lower blue clip first and trims both. The film is 1.6 s and the pictures are in the right order.
  - The editor project starts each clip at its in point.
  - After an agent groups nodes, `get_canvas` lists the members and the cost estimate leaves the group out.
- Eighteen E2E suites and the screenshot script pass. The new timeline-flow suite uses two test videos made by FFmpeg:
  - In the timeline it moves the blue clip first, sets its in point to 0.5 s and red's out point to 1.5 s. The total shows 3 s, the preview starts with blue, and after saving the node shows 「已排序」.
  - It runs the export; ffprobe finds a 3 s film, blue then red.
  - It selects both video nodes and groups them with `Ctrl G`. Dragging the title bar moves both nodes by the same distance as the frame. Double-clicking renames the group.
  - It saves the group as a template and inserts a copy from "/" (three more nodes). It ungroups one group from the context menu, and the nodes stay.
  - After a page reload the group's name and size and the timeline are all still there.
- `pnpm audit` reports no known vulnerabilities.
- GitHub Actions (commit c9c574d) passed on the first attempt:
  - CI run 43322219306: typecheck, unit tests, eighteen E2E suites (including timeline-flow) and the screenshot script.
  - Installer run 43322218900:
    - Windows installer and portable build;
    - Linux x64 / arm64 AppImage + deb;
    - macOS Apple silicon / Intel dmg + zip (the app is now `HaizhuInfinityCanvas.app`; ad-hoc signature verified);
    - Docker: token mode, HTTP MCP, the arm64 image, accounts mode.
  - Launch tests passed on all three systems: the bridge returned 18 tools, and the app recovered after its server was killed.

### Not verified yet
- How the timeline feels on a real long project with dozens of shots.
- On a slow WebUI connection, the preview may briefly show black when it switches clips.

## [1.0.0-rc.16] — 2026-11-12 (release candidate, code complete, not tagged)

"Agent access and installers for every system": as you asked, the MCP server for outside agents — planned for after 1.1 — is done now. The desktop app can be added to Claude Code like a local MCP server, so Claude can orchestrate workflows on the canvas. macOS and Linux arm64 installers are added too. The former rc.16 "timeline, groups and batches" moves to rc.17.

### Added
- **Canvas MCP server** (`POST /mcp`, Streamable HTTP, protocol versions 2025-11-25 / 2025-06-18 / 2025-03-26) with 17 tools:
  - list and create canvases; read a canvas (nodes, params, models, wires, result summaries);
  - node types and the params they accept; model profiles and skills (never API keys);
  - add many nodes and wires in one call, checked like the canvas assistant's plans (port types, one wire per single input, no cycles, known params only); change or delete nodes and wires;
  - upload assets from a local file path or base64, straight into an input node or a subject's pictures;
  - get the prompt-writing rules for the target model;
  - estimate, run (optionally only some nodes), wait, stop;
  - read full results (with local file paths), look at images and video keyframes (the agent sees the pictures), pick a variation.

  On initialize the server tells the agent the recommended workflow.
- **Show the cost before spending**: when paid models would be called, `run` only returns the number of calls and the estimate. It starts only with `confirm_cost: true`. Unchanged nodes reuse cached results and are not paid for twice.
- **Desktop: one command adds it to Claude Code.** Settings → Agent 接入 shows a `claude mcp add …` command and a `.mcp.json` snippet once access is switched on.
  - Claude Code runs the bridge script `haizhu-mcp.cjs` with the app's own executable in Node mode, so no separate Node.js install is needed.
  - The bridge finds the running app even though its port changes every launch, and **opens the app when it isn't running**.
  - It reads the access key from the data folder (readable by your OS user only), so there is nothing to copy.
  - The script is copied to the user folder at every start, so the command keeps working after updates.
- **WebUI / Docker / multi-user site**: connect over HTTP with a key. The settings page gives the command with address and key filled in; the key is masked on screen. In accounts mode each account gets its own key, which is stored only as a hash and shown once. An agent sees only that account's canvases.
- **Editing alongside the page**:
  - An agent's changes appear on the open canvas live (`GET /api/events`) and are merged with the page's unsaved edits node by node and field by field. When both sides changed the same field, the page wins.
  - Saves carry the canvas revision: if the canvas changed elsewhere, the page merges first, so nothing is overwritten. Two tabs editing the same canvas benefit too.
  - Runs started by an agent show their progress and results on the page. Opening a canvas the agent is running picks up the progress.
- **macOS installers**: a `.dmg` (plus `.zip`) each for Apple silicon and Intel. They are ad-hoc signed, with no Apple Developer ID and no notarization, so the first launch needs right-click → Open. The API-key master key is kept in Keychain.
- **Linux arm64**: AppImage and `.deb`.
- **Docker image**: the build stage runs once on the runner's own architecture; the arm64 image is built and started in CI.
- Docs: [Agent access (MCP) guide](./docs/03-guide/agent-mcp.md) (Chinese); the install notes now cover all three systems and how to open the app on macOS the first time.
- API: `/mcp`, `GET|POST|DELETE /api/agent-access`, `GET /api/events`, `GET /api/projects/:id/run`. `PUT /api/projects/:id` accepts `baseRev`; if it is stale the server answers 409 with the current canvas.

### Changed
- The canvas "tidy" layout function moved to the shared package, so nodes added by an agent are laid out the same way as on the page.
- A canvas's updated-at time doubles as its revision and now always moves strictly forward.
- Installer pipeline:
  - New macOS job: verifies the signature, then launches the app.
  - Linux builds both x64 and arm64.
  - Every desktop launch test now switches agent access on and runs the bridge with the app's own executable: initialize, tools/list and one tool call.
  - The Docker job adds an HTTP MCP smoke test and builds and starts the arm64 image.
- Roadmap: rc.17 "timeline, groups and batches", rc.18 "consistency and review", rc.19 "assistant and apps". The canvas MCP server planned for 1.3 is done.
- New E2E suite mcp-flow; CI now runs seventeen E2E suites.

### Verified
- Locally: typecheck passes; 225 unit / integration tests (core 40, server 185).
  - Three-way merge: additions from both sides are kept; the same node merges field by field with the page winning; deleted on one side and untouched on the other is deleted; deleted on one side and edited on the other keeps the edit; for a single-wire input the page's wire wins.
  - MCP access:
    - refused with an explanation while switched off; a wrong key gets 401;
    - an old key stops working after the key is replaced or access is switched off;
    - protocol versions are negotiated; a notification gets 202;
    - a cross-site Origin gets 403, an unsupported protocol version 400 and GET 405.
  - MCP tools:
    - create a canvas and add nodes; a bad wire is refused and nothing is saved, and an unknown param gets a note;
    - read the canvas;
    - a paid run needs confirmation and then completes;
    - read results with local paths and view the image;
    - changing a prompt re-runs only that node; delete nodes and wires;
    - upload a local file as an input node and as a subject's picture; a relative path is refused;
    - a video node gets the Seedance writing rules.
  - Saving from a stale revision gets 409 with the current canvas.
  - In accounts mode, two accounts' keys each see only their own canvases; a wrong key gets 401.
- With the real Claude Code CLI (2.1.322), in a separate config folder:
  - added both through the desktop bridge (stdio) and over HTTP; `claude mcp list` shows both Connected;
  - the locally packaged Linux desktop app passes its launch test under a virtual display: UI, automatic recovery from a server crash, and 17 tools through the bridge;
  - with the app closed, the bridge opened it and completed the call.
- Seventeen E2E suites all pass, plus the screenshot script. The new mcp-flow suite: switch agent access on in Settings, and the page shows the Claude Code command with the key masked → nodes added over MCP appear on the open page without a reload → the person types in one node while the agent changes another; after saving, both changes are there → a paid run first asks for confirmation; once confirmed, the agent's run progress and result show on the page. `pnpm audit` reports no known vulnerabilities.
- GitHub Actions (commit 6630f26):
  - CI run 43299369479 passed: typecheck, unit tests, seventeen E2E suites (including mcp-flow) and the screenshot script.
  - Installer run 43299369530: these jobs passed on the first attempt, and every desktop launch test includes "mcp bridge ok" (17 tools):
    - the Windows installer and portable build;
    - Linux x64 / arm64 AppImage + deb;
    - Docker: token mode, the HTTP MCP smoke test, the arm64 image built and started under QEMU, and accounts mode.
  - The macOS job got no runner on the first attempt (no logs; cancelled after 15 minutes) and passed when re-run:
    - the Apple silicon build passed signature verification (ad-hoc);
    - the master key went into Keychain;
    - the bridge returned 17 tools;
    - the app recovered after its server was killed.
  - macOS output: `HaizhuInfinityCanvas-1.0.0-rc.16-mac-arm64.dmg` / `-mac-x64.dmg` plus matching `.zip` files. The app inside is named `haizhu-infinity-canvas.app`; rc.17 renames it to `HaizhuInfinityCanvas.app`.

### Not verified yet
- A full conversation in Claude Code that calls real paid models. Locally only the connection and tool calls were checked, with models replaced by a local mock.
- The macOS package was launched only on CI's Apple silicon machine. The Intel Mac and Linux arm64 packages are cross-built and have not run on that hardware. The Windows bridge command is checked in CI but has not been added to Claude Code on a real machine.

## [1.0.0-rc.15] — 2026-11-12 (release candidate, code complete, not tagged)

"References and storyboard": keep the same character, product or scene consistent across shots, and edit a storyboard like a table. These are the "references and consistency" and "storyboard and timeline" patterns from the research (Flow's ingredients and characters, Jimeng's subject nodes, LibTV's subject library and editable shot table, LTX's Elements), built this project's own way.

### Added
- **Subject node** (library → inputs): a name (e.g. `小橘`), character / product / scene, 1–4 reference pictures (upload, drop files, or drag results from the canvas in) and a description. The node outputs its pictures, so it can also be wired into a 参考图 port.
- **`@` mentions**: typing `@` in the prompts of image / video generation, text models, director skills and the generate bar lists the canvas's subjects (↑ ↓ to choose, Enter to insert). At run time `@小橘` becomes the name and the description is added under 「设定」 at the end of the prompt; models that take reference images also receive the subject's pictures (images: Replicate / fal, Kling, Runway; video: Seedance, MiniMax-H3, Replicate / fal with `_fields.ref`), others use the description only, without an error. Changing a subject's description or pictures re-runs the nodes that mention it. With two subjects of the same name the first wins; project bundles carry subject pictures.
- **Video 参考图 (reference image) port** (several allowed): sent as `reference_image` to Seedance and MiniMax-H3; Replicate / fal need the field name in the profile defaults, `{"_fields": {"ref": "field_name"}}`; Wan, Kling, Runway, CogVideoX and SiliconFlow say clearly that they don't take one (nothing is silently dropped).
- **Storyboard table**: 「分镜表」 on a director / video-reverse node opens a full-screen table — edit title, visual, shot and camera, dialogue, duration, image / video prompts in place; move up / down, duplicate, delete, add shots; show or hide columns (remembered); `Ctrl/⌘ S` saves. Saving makes a new version of that node's result (no model call; downstream and expansion use it); tick rows to expand only those shots. Video reverse's prompt-text output is updated with the table.
- API: `PUT /api/projects/:id/nodes/:nodeId/storyboard` (every field checked and capped, at most 60 shots, keyframes only from the storyboard's own).

### Fixed
- (Caught by the first CI run) typing straight after picking an `@` suggestion could, on a slower machine, have the caret moved back a frame later, so later characters landed in front ("坐在礁石上" became "礁石上坐在"). The caret is now placed as the inserted text renders, never deferred; the E2E checks the typing order under 6× CPU throttling.

### Changed
- Roadmap: the **timeline** and **groups** move to rc.16 (with the batch node: "Timeline, groups and batches"), consistency and review becomes rc.17, agent and apps rc.18 — timeline and groups touch canvas layout, copy and paste, project bundles and undo, so they get a version of their own.
- New E2E suite story-flow; CI now runs sixteen suites.

### Verified
- GitHub Actions: CI run 43273812117 on commit de445a8 failed in story-flow (the caret issue under "Fixed"), installers run 43273811819 passed; after the fix, CI run 43275128894 on commit 8248237 passed — typecheck, unit tests, sixteen E2E suites and the screenshot script; installers run 43275128808 passed — Windows installer and portable build, Linux AppImage + deb, launch and crash-recovery tests of the packaged app, smoke tests of the Docker image in token mode and accounts mode.
- Locally: typecheck passes; 215 unit / integration tests (core 36, server 179; new: reading subjects and rejecting bad names, `@` detection (longer names first, order of appearance, e-mail addresses ignored), replacement with each description added once; an image model receives the description and pictures, a model without references uses the description only, editing a subject re-runs what mentions it and nothing else, the subject node outputs its pictures; Seedance receives wired references and subject pictures as `reference_image`, Replicate video without `_fields.ref` explains and sends nothing and sends them once it is set, Kling video explains when a reference is wired; the storyboard table saves a new version that the next run reuses, durations and shot numbers are normalised, keyframes the storyboard never had are dropped, empty storyboards and non-storyboard nodes are refused, nothing can be edited before the first run); sixteen E2E suites (new story-flow: create a subject with a picture → `@小` suggests it, Enter inserts it → the image model gets the description and picture → Seedance gets the subject picture as `reference_image` → the director knows the subject → in the storyboard table edit a cell, delete one, add one, save as a version → expand only the ticked shot) and the screenshot script pass. `pnpm audit` reports no known vulnerabilities.

### Not verified yet
- How real providers use reference images (tests use local mocks); Seedance's behaviour when reference images and a first frame are combined is up to the provider.

## [1.0.0-rc.14] — 2026-11-12 (release candidate, code complete, not tagged)

"Studio": a survey of 30+ image / video creation platforms first, then the most common, step-saving patterns built into the canvas in this project's own way — generate as soon as you think of it, write prompts the way the target model reads them, make several and pick one, generate shot after shot. Only interaction ideas are borrowed; no product's code, copy or look is copied.

### Added
- **Platform research**: [image / video creation platforms](./docs/00-research/05-creative-platforms.md) (in Chinese) — closed products Google Flow, Jimeng / Dreamina, LibTV, Kling, Hailuo, Vidu, Runway, Krea, Flora, Figma Weave, Freepik Spaces, LTX Studio, Lovart, Xingliu, Higgsfield, Luma, Midjourney, Firefly Boards and Leonardo, plus open-source ComfyUI, InvokeAI, Krita AI Diffusion, SwarmUI, Jaaz and short-drama pipelines. It distils eleven common patterns (prompt bar, variations and picking, references and consistency, extend and frame grabs, storyboard and timeline, batches, prompt optimisation and skills, agents, reuse, export, smoothness) and the official prompt-writing rules of Wan, Seedance, Kling and Hailuo, and lists this project's gaps and what it will not borrow.
- **Optimisation plan and roadmap**: [optimisation plan (2026-11)](./docs/02-roadmap/optimization-plan-2026-11.md) (in Chinese); the roadmap gains rc.15 "References and storyboard", rc.16 "Batches and consistency" and rc.17 "Agent and apps".
- **Generate bar** (bottom of the canvas): write a sentence, choose image / video, model, aspect ratio, duration and count, press `Enter`. The result is an ordinary generation node on the canvas — wire it, change it, regenerate it as usual. Pictures selected on the canvas (image nodes, or image generations that already have a result) come along as references / first frame / last frame, or upload one; the estimated cost (price × count) sits next to the button. While a run is going it says "queue" and starts afterwards instead of interrupting it. It is always shown on an empty canvas; once there are nodes it opens from the bottom toolbar (and stays open after you use it). Enter while an input method is composing does not generate.
- **Optimise prompt** (in a generation node's properties and in the generate bar): your own text model rewrites the prompt the way the target model reads best — video: Seedance, Kling, Wan, Hailuo (bracketed camera commands), MiniMax H3, Runway, CogVideoX, Veo, generic; image: Seedream, Wan, Kling, GPT Image, Gemini, FLUX, Stable Diffusion, generic. With a first frame connected it writes motion and camera only; a vision model looks at the first frame / references while rewriting; the meaning is kept (subjects, lines, brands, on-screen text unchanged); language auto / Chinese / English. The result is shown first and only replaces the prompt on "use this one"; a prompt that comes from an upstream text node is written back there. The rules are written by this project from the structure of each provider's official guide.
- **Prompt skills**: skills gain a "prompt" purpose (imported like reverse / director skills from GitHub, a ZIP or pasted text; recognised automatically when the name or description mentions prompts), selectable in "Optimise prompt" instead of the built-in rules.
- **Several results at once**: image / video generation nodes take a count of 1–4, generated side by side (each call billed and resumable on its own, never paid twice) and shown as a grid; "pick" one and only it flows downstream while the rest stay in the versions; when some fail, the successful ones are kept. The pre-run estimate multiplies by the count.
- **Continue from the last frame**: ⏭ on a video result takes its last frame as an image node and adds a video generation that starts from it (same model and settings). **Save this frame**: in the full-screen preview, the frame you paused on becomes an image node. Both need FFmpeg.
- **Enter runs the selected nodes** (when not typing); the shortcuts sheet and guides are updated.
- API: `POST /api/prompt/optimize`, `POST /api/projects/:id/nodes/:nodeId/pick`, `POST /api/assets/:id/frame`.

### Changed
- The screenshot script hides the generate bar in canvas shots and adds a shot of it; a new E2E suite, studio-flow, makes fifteen suites in CI.

### Verified
- GitHub Actions (commit 1b605b6) passed on the first try: CI run 43268504101 — typecheck, unit tests, fifteen E2E suites (including studio-flow) and the screenshot script (24 shots); installers run 43268504157 — Windows installer and portable build, Linux AppImage + deb, launch and crash-recovery tests of the packaged app, smoke tests of the Docker image in token mode and accounts mode.
- Locally: typecheck passes; 203 unit / integration tests (core 33, server 170; new: prompt-family detection (model name first, then adapter), the rewrite request carries the matching rules / first-frame rule / language, a skill replaces the built-in rules, cleaning model answers (code fences, "prompt:" labels, wrapping quotes); the optimise API — the target model's rules reach the text model, a vision model receives the first frame, an imported prompt skill applies, errors are explained and the key never leaks; a count of 3 makes 3 calls at 3× the price, keeps the successful ones when one fails, "pick" leaves one result as a new version that the next run reuses; with a test clip made by FFmpeg, the "last frame" really is the final picture, frames by time work, non-videos and bad times are refused); fifteen E2E suites (new studio-flow: on an empty canvas the generate bar makes 2 variants with Enter, shows 0.4 CNY and no extra dialog → pick the second → optimise in the bar and in the properties (target rules sent) → the selected generated picture becomes a video's first frame → continue from the last frame, save a frame from the full-screen preview → Enter runs the selected node, the bar queues during the run and starts afterwards) and the screenshot script pass. `pnpm audit` reports no known vulnerabilities.

### Not verified yet
- How good the rewrites are depends on the text model you choose; the built-in rules follow the structure of each provider's public guide (Runway's guide page refused automated reading, so it follows the common pattern). Try a few prompts with your usual model; import your own prompt skill if the rules don't suit you.
- With several results at once, provider rate limits (429) vary by account; the default count is 1.

## [1.0.0-rc.13] — 2026-11-12 (release candidate, code complete, not tagged)

Connects the model services creators use most: video, images and speech no longer have to go through Replicate / fal. Also starts English release notes (this file); from now on every release is written in both Chinese and English.

### Added
- **Provider-native adapters** (written from each provider's official API reference; see [Connecting model providers](./docs/03-guide/model-providers.md), in Chinese):
  - Volcengine Ark **Seedance** video (`ark`): text-to-video, first frame / first + last frame; stopping a run cancels a queued task.
  - Alibaba Cloud Model Studio **Wan** (`dashscope`): wan2.7 text- and image-to-video (`media` list), older first-frame models, first-and-last-frame models (`kf2v`); wan2.6 and earlier text-to-image; Beijing and international endpoints.
  - **Kling** (`kling`): the current API-key authentication; text- and image-to-video (model in the path, first + last frame) and image generation (one reference image); only the unwatermarked result is downloaded.
  - **MiniMax Hailuo** (`minimax`): Hailuo-02 / 2.3 (v1) and MiniMax-H3 (v2) video, with the download link fetched automatically; **synchronous speech** (t2a_v2, hex audio decoded); China and international endpoints.
  - **Runway** (`runway`): image-to-video (first + last frame), text-to-video, text-to-image (up to 3 reference images) and speech; aspect ratios converted to Runway's pixel ratios, progress shown as a percentage, cancelled on stop; images over about 3.3 MB are flagged before submitting.
  - Zhipu **CogVideoX** video (`zhipu`) and **SiliconFlow** video (`siliconflow`).
  - **ElevenLabs** speech (`elevenlabs`): the voice is a voice_id, or a premade voice when left empty.
- **OpenAI-compatible presets** for Google Gemini (chat, vision, Gemini image models), Kimi (Moonshot), Zhipu (GLM chat and vision, CogView images), SiliconFlow (chat, images, speech) and MiniMax chat; Volcengine Ark gains images (Seedream).
- **Adding a model**: providers are grouped as China / international / local; picking one lists its **common models**, and one click fills the model ID. Switching the kind keeps the provider when it offers that kind too (Kling video → Kling image), otherwise falls back to a custom address. Picking a provider writes the default params it needs (SiliconFlow's `image_size`, Gemini's `b64_json`) without overwriting params you changed.
- **Test connection** covers every new adapter, using only free read-only requests (listing tasks or models, or asking for a task that does not exist to tell a valid key from an invalid one).
- The speech node's voice hint follows the chosen provider (OpenAI `alloy`, MiniMax voice_id, ElevenLabs voice_id, Runway preset names).
- English release notes ([CHANGELOG.en.md](./CHANGELOG.en.md)): full translations from rc.9, summaries before that.
- New guide: [Connecting model providers](./docs/03-guide/model-providers.md) (overview table, how node parameters map to each API, caveats, sources and what was verified).

### Changed
- A node's advanced params (JSON) merge level by level for provider-native adapters: `{"parameters": {"seed": 42}}` adds a seed without dropping the aspect ratio and duration.
- The OpenAI-compatible image call reads both `data[]` and `images[]` and accepts `_sizeField` to name the size field.
- Test connection explains that a 404 may also mean the provider has no model list.
- The landing page lists the newly supported providers.

### Not added
- Google video: the Veo 3.1 preview and the old Imagen API were shut down by Google in 2026, and the replacement API works differently; it is not in this release. Veo is available through Runway (`veo3.1`), fal or Replicate.

### Verified
- GitHub Actions (commit 16a8962) passed on the first try: CI run 43221361644 — typecheck, unit tests, fourteen E2E suites and the screenshot script (23 shots); installers run 43221361650 — Windows installer and portable build, Linux AppImage + deb, launch and crash-recovery tests of the packaged app, smoke tests of the Docker image in token mode and accounts mode.
- Locally: typecheck passes; 189 unit / integration tests (core 29, server 160; 23 new: each provider's request shape — first / last frame, aspect and duration conversion, negative prompt, reference images, level-by-level merging with prototype-pollution protection; a full "submit → queued / running → done → download" run against a local mock of every provider, Kling downloading only the unwatermarked copy, MiniMax querying and then fetching the download link and decoding hex speech, Runway sending its version header on every call and reporting a percentage, Model Studio failure messages shown as-is, wrong first / last frame combinations explained before anything is sent; native adapters accept only the kinds they serve; Runway and ElevenLabs connection tests); fourteen E2E suites (smoke adds: picking Kling fills adapter and address, a common-model chip fills the ID, switching the kind keeps the provider, falling back to a custom address when it does not) and the screenshot script (one new shot of the grouped provider picker) pass. `pnpm audit` reports no known vulnerabilities.

### Not verified yet
- **No provider has been called with a real account**: tests use local mock services. Run the cheapest model with your own key first; if a provider has changed a field, override it in the node's advanced params and tell me so I can fix it.
- The ElevenLabs text-to-speech reference page could not be opened during development (server error), so that call follows the official SDK's usage; the official docs do not say whether Zhipu has a model list, which sizes Seedream accepts, or whether SiliconFlow video accepts data-URI images.

## [1.0.0-rc.12] — 2026-11-12 (release candidate, code complete, not tagged)

Run the website as a service: administrators no longer need to sign in to the server and type commands. Only affects accounts mode (`HZC_ACCOUNTS=1`); the desktop app and token mode are unchanged.

### Added
- **Admin console at `/admin`** (for accounts listed in `HZC_ADMIN_EMAILS`, or promoted with `admin promote <email>`): an overview (accounts, active and new in the last 7 days, storage used, total runs), the sign-up mode, invite links, and the list of accounts (status, storage used / limit, runs, last sign-in). Per account: disable / enable (disabling signs the person out on every device), reset password (a one-time temporary password, shown once), a storage limit of its own, make / remove admin, and delete (you type the person's email to confirm). Admins cannot disable or delete themselves or remove their own admin role. There is a link to the console in Settings → Account.
- **Three sign-up modes**: open / invite only / closed, switchable at any time in the console (`HZC_SIGNUP` is the default and gains `invite`).
- **Invite links**: number of uses, days valid and a note; the link is shown once and the server only keeps its hash; links can be revoked; a failed sign-up (for example a weak password) does not use up an invite.
- **Password reset by email** (once `HZC_SMTP_URL` / `HZC_MAIL_FROM` / `HZC_PUBLIC_URL` are set): "Forgot password?" on the sign-in page → a link valid for 30 minutes that works once → after setting a new password every device is signed out and the person is signed in. The answer is the same whether or not the email has an account; 5 requests per hour per address and at most 3 mails per hour per account. Without a mail service, the page says to contact the administrator.
- **Usage figures**: storage used and runs per account are updated as people work and shown in the console.
- New dependency nodemailer (MIT-0, no dependencies of its own) for sending mail.

### Fixed
- Opening `/reset?token=…` treated the reset token as the desktop access token and removed it from the address; this now happens on other pages only.
- Sign-up did not record a "last sign-in", so new accounts showed "never signed in" in the console.
- The rc.10 test "a run id is useless in another account" used a canvas without a version number, so the run never started and the test passed without testing anything; it now starts a real run before checking.

### Verified
- GitHub Actions (commit b6766a8) passed on the first try: CI run 43215282144 — typecheck, unit tests, fourteen E2E suites (including admin-flow) and the screenshot script; installers run 43215282200 — Windows installer and portable build, Linux AppImage + deb, launch and crash-recovery tests of the packaged app, smoke tests of the Docker image in token mode and accounts mode (new: an ordinary account calling the admin API is refused with 403).
- Locally: typecheck passes; 166 unit / integration tests (core 29, server 137; new: non-admins always get 403 from the console API, invite-only mode and invite uses / revoking / hash-only storage, closed sign-up, sessions end when an account is disabled, the admin's temporary password works, a per-account storage limit applies at once, deleting an account deletes its whole workspace, admins cannot disable / demote / delete themselves, password reset does not reveal whether an email exists, a weak password does not use up the reset link, the link works once, all old sessions end, 501 without a mail service, `promote` / `demote` commands); fourteen E2E suites (new admin-flow: the admin opens the console from Settings → switches to invite only and creates a link → a visitor without the link is turned away, one with it signs up → disabling signs them out → enable → after a password reset they sign in with the temporary password → the full "forgot password" flow through a local mail sink) and the screenshot script pass; the desktop app starts and recovers from a crash. `pnpm audit` reports no known vulnerabilities.

### Not verified yet
- A real mail provider (tests use a local SMTP sink); whether mail lands in spam depends on your domain's SPF / DKIM setup.

## [1.0.0-rc.11] — 2026-11-12 (release candidate, code complete, not tagged)

The interface loses its "AI look" and is redesigned with the Galaxy components and Taste Skill rules you provided (decision and reasons in [ADR-0005](./docs/01-architecture/ADR-0005-graphite-design-system.md)). No functional changes.

### Changed
- **Colour**: neutral graphite (Taste Skill palette "Graphite and orange"); 90–95% of the interface has no colour, so the work is the only large area of colour on screen. The single accent is signal orange `#ff4a1f`, used only for primary buttons, focus, the selected node, run progress and switches. The light theme is a cool grey.
- **Removed AI-style elements**: tinted glow shadows on buttons, the gradient logo tile, coloured tiles behind icons, monospace uppercase eyebrow labels, the sparkle icon ✨, pill status badges, frosted glass, the starfield background (and its switch in Appearance), and on the landing page the gradient text, glows, tag row and numbered steps.
- **Type and shape**: Geist + Geist Mono (Inter removed); radii 4 / 6 / 8; flat surfaces with hairlines; no letter-spaced labels.
- **Galaxy components** (only ones without gradients or glows, rewritten with this project's tokens and each listed in THIRD_PARTY_NOTICES): segmented control, switch, underline link, tooltip, the icon toolbar at the bottom of the canvas, node run progress bar, tick spinner, checkbox, canvas grid (a fine line grid instead of dots).
- **Nodes**: status is a small coloured icon plus text; a running node has a progress line along its top edge; selection is a thin orange outline instead of a glow. The minimap shows grey blocks, with the selected node in orange.
- **Data type colours** appear only on ports and edges and avoid the accent (video is now amber, storyboard light grey).
- **Brand mark**: "Haizhu" (海柱, sea pillar) — an orange pillar standing on two wave lines; the app and web icons are now flat graphite. The top bar no longer shows the version (it is in Settings → About).
- **Landing page** rewritten to the Taste Skill rules for software pages: the hero is "a node canvas for image and video creators" with one line of explanation and the supported APIs and platforms, two buttons, and a large real product screenshot below; an opaque top bar; workflows (switchable real screenshots), features (each card with a real screenshot), three ways to run it, and a closing line; all landing screenshots use the new interface. The sign-in / sign-up pages share the same buttons and cards.
- Plainer copy: the empty canvas title is now "Start a flow from a template", without metaphors.
- The screenshot script scrolls the inspector back to the top before each shot.

### Verified
- GitHub Actions (commit 4a699f6) passed on the first try: CI run 43178416077 — typecheck, unit tests, thirteen E2E suites and the screenshot script; installers run 43178416218 — Windows installer and portable build, Linux AppImage + deb (new icon), the packaged app starts on Windows / Linux and recovers after its background server is killed, Docker smoke tests in token mode and accounts mode.
- Locally: typecheck passes; 160 unit / integration tests (core 29, server 131); thirteen E2E suites and the screenshot script (22 shots) pass; the landing page checked shot by shot at 1440 / 1024 / 390 px in dark and light themes; landing copy checked with the Taste Skill copy-lint: 0 failures, 0 warnings (the tool counts English word lists, so the Chinese text was reviewed by hand against its rules); the desktop app started on a virtual display, recovered after its server was killed and showed the new interface. `pnpm audit` reports no known vulnerabilities.

### Not verified yet
- Your sign-off on the look (screenshots were shared in the conversation); font rendering on real Windows machines (Chinese falls back to Microsoft YaHei).

## [1.0.0-rc.10] — 2026-11-12 (release candidate, code complete, not tagged)

SaaS: with accounts mode (`HZC_ACCOUNTS=1`) the same program can be deployed as a multi-user website — visitors sign up and sign in, everyone gets a private workspace and brings their own model keys. Built to your choices: email + password, personal workspaces, users bring their own API keys. The desktop app and token-mode web deployments are not affected.

### Added
- **Sign up / sign in**: `/signup` and `/login` pages (same style as the landing page); email + password (at least 8 characters; repeated characters and common weak passwords are refused). Visitors see the landing page first, whose navigation and main button become "Sign in / Sign up free"; when a session expires the person is sent to sign in and then back to the canvas they were on.
- **A private workspace per person**: every account has its own database file and folder (`/data/users/<id>/`: canvases, model profiles with encrypted API keys, assets, imported skills, generation records, backups). Each request first establishes who is asking and then opens only that person's workspace, instead of relying on every query remembering a user condition.
- **Account settings** (Settings → Account, also from the avatar in the top bar): storage used, change password (other devices are signed out), sign out other devices, sign out, delete account (needs the password and typing "删除" (delete) to confirm; deletes all data).
- **Storage limit**: 2 GB per account by default (`HZC_USER_QUOTA_MB`); uploads, imports and generations say so when it is full. The asset library gains a delete button to free space (also in single-user mode).
- **Admin commands** (no mail service needed): `node server/index.mjs admin users | create-user | reset-password | disable | enable | delete-user`, run with `docker compose exec` in Docker; creating and resetting print a temporary password. With `HZC_SIGNUP=closed` only the administrator can create accounts.
- New deployment guide: [Deploy as a multi-user website](./docs/03-guide/saas-deployment.md) (Docker + Caddy HTTPS, environment variables, admin commands, data layout, security design and limits; in Chinese).

### Security
- Passwords hashed with salted scrypt (N=2^15), compared in constant time; unknown emails go through the same computation so response time does not reveal whether an email is registered.
- Sessions: 256-bit random tokens in HttpOnly + SameSite=Lax cookies, with the `__Host-` prefix + Secure over HTTPS; only hashes are stored; 30-day sliding expiry; a new session on every sign-in.
- Failed sign-ins: lockout after 10 failures in 10 minutes per address or 30 in an hour per account; at most 5 sign-ups and 30 sign-up attempts per hour per address (so "already registered" cannot be used to probe emails in bulk); over HTTPS only the `__Host-` cookie is accepted (other sites on the same domain cannot plant a session); every changing request (sign-in and sign-up included) keeps the origin check, so other sites can neither act with the person's session nor sign them in to another account.
- In accounts mode model endpoints may not point at the server's private network by default (`HZC_BLOCK_PRIVATE_NETWORK` defaults to 1); listening on a public address requires `HZC_ALLOWED_HOSTS` or the server refuses to start; `/api/system` no longer tells ordinary users the server's Node version, OS or FFmpeg path.
- FFmpeg is limited server-wide (`HZC_MAX_FFMPEG`, default half the CPU cores, 1–4), so one person exporting a film cannot occupy the whole server; manual backups at most once a minute.
- The origin check now handles default ports written in the Host header (`:80` / `:443`).

### Changed
- `docker-compose.yml` no longer requires `HZC_TOKEN`: token mode and accounts mode are alternatives (with neither, the server refuses to start and says why); adds `HZC_ACCOUNTS`, `HZC_SIGNUP`, `HZC_USER_QUOTA_MB`, `HZC_SECURE_COOKIES`.
- In accounts mode the landing page's deployment section reads "Everyone's own space, invisible to the others".

### Verified
- GitHub Actions (commit 375b1c1) passed on the first try: CI run 43150917241 — typecheck, unit tests, thirteen E2E suites (including saas-flow) and the screenshot script; installers run 43150917270 — Windows installer and portable build, Linux AppImage + deb, the packaged app starts on Windows / Linux and recovers after its server is killed; the Docker image runs with a read-only root filesystem and no capabilities in both modes: accounts mode without `HZC_ALLOWED_HOSTS` refuses to start, unauthenticated requests get 401, two accounts cannot see each other's canvases, cross-site sign-in is refused, `admin users` lists 2 accounts, `docker stop` exits with code 0.
- Locally: typecheck passes; 160 unit / integration tests (core 29, server 131); thirteen E2E suites (new saas-flow: visitor → landing → sign-up (weak password refused) → canvas → account settings → sign out → sign in back to the same canvas → a second account cannot see the first account's canvas or files → an expired session goes to the sign-in page) and the screenshot script pass.
- New test coverage: every API returns 401 without a session (except health and sign-in), cookie attributes, canvases / assets / model profiles / prompts / run ids / project bundles are invisible and unchangeable between two accounts, duplicate, weak and cross-site sign-ups refused, closed sign-up, sign-up rate limit, sign-in lockout with identical error messages, changing the password ends other sessions, deleting an account deletes its whole workspace, storage limit and freeing space by deleting files, the `__Host-` cookie over HTTPS, admin commands (create / reset / disable / enable / delete / list).

### Not verified yet
- Deployment behind a real domain and HTTPS reverse proxy (tests use local addresses and a simulated `X-Forwarded-Proto`); your Caddy / Nginx configuration needs a real run.
- No email verification or password-reset mail, no paid plans, no team sharing (see "Current limits" in the deployment guide).
- Your sign-off on the landing and sign-in page copy and visuals.

## [1.0.0-rc.9] — 2026-11-11 (release candidate, code complete, not tagged)

Security hardening and redundancy: web deployments (WebUI / Docker) are harder to attack, and when something critical fails no data is lost and the service recovers by itself. No interface changes apart from a data backup section in Settings → About.

### Security (vulnerabilities fixed)

| Issue | Severity | Fix |
| --- | --- | --- |
| Vulnerable dependencies: `@fastify/static` (serves the web files) could be bypassed by path traversal; two arbitrary-code issues in vitest's tinypool (dev tool), and others | High (runtime) / critical (dev tool) | Upgraded; `pnpm audit` down from 16 findings (2 critical, 1 high, 12 moderate, 1 low) to 0 |
| DNS rebinding: another site could make the browser resolve its domain to 127.0.0.1 and call the API as if it were the local page | High | Without an access token only localhost / 127.0.0.1 are accepted (`HZC_ALLOWED_HOSTS` adds your own domains); anything else gets 421 |
| Cross-site requests: pages on other sites sending POSTs to the local server (for example changing model profiles or deleting projects) | High | Changing endpoints check `Origin` and `Sec-Fetch-Site`; requests from other sites (including other ports on the same machine) get 403; `text/plain` bodies (a type that skips preflight) are no longer parsed |
| Missing browser security headers: could be framed by other sites (clickjacking), no content security policy | Medium | Pages carry a CSP (scripts from this site only), refuse framing, `nosniff`, no referrer (asset links may carry the token), cross-origin isolation; asset files are served sandboxed so they cannot run scripts even when disguised as images; optional HSTS |
| SSRF: a malicious or compromised provider could make the server read cloud metadata (with credentials) or internal services | Medium | Outbound requests always refuse link-local / metadata / reserved addresses; with `HZC_BLOCK_PRIVATE_NETWORK=1` loopback and private addresses are refused too (on by default in Docker); downloads check the address actually connected to (against DNS rebinding) and every redirect, with a size limit; results may come from a private address only when the model itself is on the private network |
| The access token could be guessed character by character through timing, with unlimited attempts | Medium | Constant-time comparison; 10 failures in 10 minutes from one address lock it for 10 minutes (429); a token in the URL is accepted only for asset and bundle downloads |
| Internal server errors returned internal details to the browser | Low | 5xx responses carry a generic message; details go to the server log |
| Malicious project bundles (zip bombs) filling the disk or memory | Low | Imports limit the number of files (20,000) and the total unpacked size |
| Desktop: pages could request camera, microphone and other permissions, be navigated or redirected to other sites, or embed webviews | Low | Every permission is denied except clipboard write and fullscreen; navigation and redirects away from the local address are blocked; webviews are disabled |

### Added (redundancy)
- **Automatic database backups**: at start-up (if the interval has passed) and every 6 hours, the database is copied consistently into `backups/` in the data folder, keeping the latest 14 (`HZC_BACKUP_HOURS` / `HZC_BACKUP_KEEP`). Written to a temporary file and then renamed, so a power cut mid-backup leaves no broken backup. Settings → About shows the last backup time and has "Back up now"; API `GET/POST /api/backups`.
- **Start-up check and automatic restore**: every start runs an SQLite integrity check; when the data file is damaged (disk errors, overwritten by sync software, emptied) it is renamed and kept (never deleted), the newest backup that passes the check takes its place, and the interface says "restored from backup" with the backup time. Files that merely cannot be checked (for example locked by another program) are not treated as damaged.
- **Local copy of unsaved changes**: when saving fails (server not responding, network down) the canvas is also kept in this browser; auto-save retries after 2 / 5 / 10 / 20 / 30 / 60 seconds and immediately when the network returns, and clears the local copy once it succeeds. Closing or reloading with unsaved changes asks first and keeps them too; the next time the canvas opens it offers "Changes not saved to the server were found" with "Restore". The top bar shows "Save failed · retrying".
- **Provider calls retried without paying twice**: requests that cost nothing (reads, polling, downloading results) are retried 3 times on network blips or 5xx (honouring `Retry-After`); a paid submission is retried only when it surely was not accepted (connection refused, 429, 503). A generation that finished but failed to download is picked up on the next run instead of being paid for again; losing the provider mid-poll keeps waiting (up to 5 times in a row) instead of failing the job.
- **Automatic restart of a crashed server (desktop)**: when the background server crashes or is killed, it is restarted and the window reloads (at most 3 times in 5 minutes, then a message). The packaged-app test kills the server on purpose to check the app recovers.
- **Graceful shutdown**: on SIGTERM / SIGINT (Docker stop, system shutdown) or when the desktop app quits, the server stops accepting requests, waits for those in progress, closes the database, and exits by force after 10 seconds; generations in progress at the provider are not cancelled (the next run picks up the results). The desktop app tells the server to exit over IPC (Windows has no SIGTERM); if the desktop app itself crashes, the server exits on its own instead of lingering.
- **Atomic writes**: asset files and the encryption key file are written to a temporary file, flushed and then renamed, so a power cut never leaves half a file; incomplete asset files left by older versions are repaired the next time the same content is written.

### Changed
- `docker-compose.yml`: `HZC_BLOCK_PRIVATE_NETWORK=1` by default (**behaviour change**: Docker deployments cannot reach model servers on the host or private network by default; set it to 0 to use Ollama or other local servers); the container runs with a read-only root filesystem, all Linux capabilities dropped and no privilege escalation; 20 seconds are allowed for a graceful stop.
- A web deployment listening on a non-local address refuses to start when `HZC_TOKEN` is shorter than 16 characters or still the `.env.example` sample.
- After a failed save succeeds on retry, the app says "Connection restored, changes saved".
- New environment variables: `HZC_ALLOWED_HOSTS`, `HZC_HSTS`, `HZC_TRUST_PROXY`, `HZC_BLOCK_PRIVATE_NETWORK`, `HZC_BACKUP_HOURS`, `HZC_BACKUP_KEEP`; see the [deployment guide](./docs/03-guide/projects-and-desktop.md#安全部署清单) (in Chinese).

### Verified
- GitHub Actions: installers run 43050400270 (commit ebe38ea) passed on the first try — Windows installer and portable build, Linux AppImage + deb, the packaged app starts on Windows / Linux and recovers after its server is killed; the Docker image runs with a read-only root filesystem and no capabilities, checked for security headers, refused cross-site requests, backups, a clean `docker stop` (exit code 0) and data kept across restarts; weak / sample tokens refuse to start. CI run 43148406304 (commit e98a2bf, same application code as ebe38ea) passed: typecheck, unit tests, twelve E2E suites (including resilience-flow) and the screenshot script. Three earlier CI runs were cancelled after timing out while installing FFmpeg because the GitHub runner could not resolve the Ubuntu mirror; CI now checks the mirror first with a time limit and falls back to a static FFmpeg build from GitHub.
- Locally: typecheck passes; 146 unit / integration tests (core 29, server 117); twelve E2E suites (new resilience-flow: a failed save is kept and retried until it succeeds, unsaved changes are restored after a reload, SIGTERM exits cleanly, a damaged database is restored from backup) and the screenshot script (2 new shots: save retry and data backup; 22 in total) pass; the desktop app started on a virtual display, restarted its server after it was killed and showed the interface again, and on quit the server shut down on request with no leftover process.
- Note: when the local shell has no UTF-8 locale, headless Chromium falls back to `download` for Chinese download file names and video-flow fails; this is unrelated to the app (it reproduces against a bare server) and passes with `LANG=C.UTF-8` (as in CI).
- New test coverage: host allowlist (DNS rebinding), cross-site POSTs (other sites, other local ports and `null` origins are all refused), `text/plain` refused, URL tokens accepted only on the designated routes, lockout after repeated failures, security headers and CSP, 5xx without internal details, zip bombs refused, address classification (including IPv4-mapped IPv6), redirects to metadata addresses refused, results of public models cannot point at private addresses, download size limit, 503 retried until success, paid requests retried only when not accepted; backup rotation and retention, damaged / emptied databases restored from the newest good backup (skipping equally damaged ones), with no usable backup the damaged file is kept and the app starts empty, bad backup settings never wipe backups, half-written asset files repaired.

### Not verified yet
- The graceful-shutdown path on Windows (IPC) was verified on Linux only; the Windows packaged-app test covers automatic restart after a crash (CI results above).
- Retry behaviour against real providers (tests use local mock servers).
- The SaaS platform (email sign-up, private workspaces) moved to rc.10.

## Earlier versions (summary)

Short English summaries; the full notes, including test results, are in [CHANGELOG.md](./CHANGELOG.md).

- **1.0.0-rc.8** (2026-11-11) — Public landing page at `/welcome`, designed from layout patterns of ten reference design sites without copying any template, copy or asset; two landing screenshots added to the screenshot script (20 in total).
- **1.0.0-rc.7** (2026-11-11) — Parallel runs: independent nodes run at the same time (4 in total by default via `HZC_MAX_PARALLEL`, 3 per model, configurable per profile; 1 per Ollama server); a failed node only skips its dependents. Faster loading with precompressed Brotli / gzip assets and long-term caching (first load 757 kB / 1.38 s → 252 kB / 0.90 s on a simulated 10 Mbit/s link). A reproducible screenshot script (18 shots) uploaded by CI. Comparison nodes laid out in a row; lazy-loaded canvas images; internal `_` settings no longer sent to text / vision providers.
- **1.0.0-rc.6** (2026-11-09) — Import and use image-reverse skills: import a skill from a GitHub link, a ZIP or pasted SKILL.md (only SKILL.md, `references/` Markdown and LICENSE / README are kept; scripts are never stored or run), with licence detection. Reverse nodes can use an imported skill; a new negative-prompt port is passed to generation nodes. GPL skills such as LunarXuan/image-prompt-reverse are imported by the user and never bundled.
- **1.0.0-rc.5** (2026-11-09) — Multi-model A/B comparison (up to 4 models of the same kind side by side, pick the winner) and large-canvas performance work measured on a 300-node canvas.
- **1.0.0-rc.4** (2026-11-07) — Interaction ideas borrowed from a reference canvas product (no code, copy or assets copied): a canvas assistant that builds flows with your own text model, the projects manager with covers, a prompt library, minimap / snap toggles and keyboard shortcuts.
- **1.0.0-rc.3** (2026-11-07) — The creative loop: result versions (30 per node), keep the current result while regenerating, add nodes by dropping an edge on empty space, run progress, find node, drag results out, tidy layout, more templates.
- **1.0.0-rc.2** (2026-11-06) — Usability: models chosen automatically for new nodes, a pre-run check with in-place fixes, actionable errors, undo / redo, copy / paste / duplicate, drag-and-drop or paste files, a shortcuts panel, simpler model setup with a connection test.
- **1.0.0-rc.1** (2026-11-05) — Portable project bundles (`.hzc`), hand-off to editors as a Shotcut / MLT project, the API-key encryption key kept in the system keychain on desktop, and a fix for the Windows installer being overwritten by the portable build.
- **1.0.0-beta.6** (2026-11-05) — Export film node: concatenates clips with matching size, frame rate and sample rate, mixes voice-over, embeds subtitles and writes SRT; H.264 / AAC.
- **1.0.0-beta.5** (2026-11-05) — "Studio" content-first interface; FFmpeg integration and video prompt reverse (scene detection → shots → per-shot prompts).
- **1.0.0-beta.4** (2026-11-05) — TTS node, Agent Skills (SKILL.md) with three built-in director skills, the director node with storyboard fan-out onto the canvas, and the `/` command palette.
- **1.0.0-beta.3** (2026-11-05) — Name corrected to Haizhu (海柱); interface redesign; image generation (OpenAI-compatible, Replicate, fal) and video generation (Replicate, fal) with persistent async jobs that are resumed instead of resubmitted; cost confirmation before paid runs.
- **1.0.0-beta.2** (2026-11-05) — Execution engine with caching, OpenAI-compatible and Ollama adapters, the first working nodes (text, media inputs, text model, vision, image prompt reverse) and the asset library.
- **1.0.0-beta.1** (2026-11-05) — Project set-up.

# Studio Ochen / Junior AI Developer

Source vacancy: https://hh.ru/vacancy/138530283
Role: ship working AI-assisted prototypes for the Snapbuild controlled image/video generation product. They value working results, initiative, integrations and quality, not years/credentials.

Employer task (Figma design 4MCFttsSoP7hgQh29zq5G3): compose illustrations only from objects in the original 20 illustrations. No newly generated visual objects. AI allowed for coding and metaphor analysis. Preserve vector geometry and proportions; recoloring is explicitly required.

Required: import or use source SVG library; automatic composition from headline/metaphor or component names; move/rotate/duplicate/delete; layer order; canvas dimensions and color scheme; user palette import and automatic recoloring; editable SVG export. Deliver runnable service/project, repository, architecture explaining storage/extraction/reuse, AI tools disclosure and 2–3 example compositions. Quality over feature count. Employer states noncommercial assessment use.

Design: a neutral vector editing workspace named Сборка. Library on the left, visible SVG stage in the centre, transformations and layers on the right. Top prompt and two automatic selection modes. Explicit matching explanations; no fake AI or external model call. Color #F4F5F7 background, #FFFFFF surfaces, #252A34 ink, #7165B7 selection, #D86A50 export/action, #DDE1E8 dividers. Source artwork is the visual identity; no replacement illustrations.

Original employer assets are password-protected. Do not publish them publicly without explicit permission. Generic source code may be public; original SVG inputs and example exports are delivered back to employer privately. Empty public demo accepts source SVG through upload. Project JSON export/import preserves assets and scene; local autosave with error feedback.

Tasks:
1. Vector core: strict SVG validation, stable source hashes and IDs, original geometry, safe ID reference remapping, palette, metadata matching, composition/export. Regression tests.
2. Workspace: upload library/project/palette, editable stage and transformations, keyboard/drag/layers, autosave, import/export and error/empty states.
3. Obtain original assets through permitted UI or archive, generate and inspect three examples; don't substitute fabricated employer illustrations.
4. Independent code/spec review, fix substantive findings; build/tests and browser QA; publish generic code/demo, private handover artifacts, then review HH messages and suitable applications.

## Binding library-introduction requirements

Source components have S/L detail variants and main/background roles. Detail is independent of canvas dimensions. Editable family/detail/role metadata is optionally parsed from `Family--S--main.svg`; normal source names default to L/main (or current detail on fresh UI import). A scene switch requires exactly one counterpart by normalized family, role and target detail for every layer. It uniformly fits each new source into the old bounding box, keeping position, rotation, visibility, order and locks. Missing/ambiguous counterparts cancel the whole change. No fake detail or new geometry is generated. The complete-library metadata selector also exposes inactive-detail sources.

Three extendable presets each have background and object palette groups. Main assets can use their union; backgrounds can only use the background group. Source dark outlines, alpha and structural mask/filter paints remain protected. Applied palette groups persist in scene state; export derives role-specific maps. Flat TXT/JSON arrays contain 2–8 object HEX colors and set neutral background `#e4e9f1`. Grouped JSON `{background:[HEX...],objects:[HEX...]}` permits 1–8 unique colors per group. Legacy colorMap only applies to main assets. Metadata/palettes never modify original source bytes, hashes or geometry.

The implementation does not establish compatibility with unavailable employer originals. Actual counterpart names/roles, three employer-source compositions and source-based visual verification remain pending.

/**
 * App shell — Phase 0 placeholder.
 *
 * The editor (Canvas, Toolbar, Panels) is intentionally NOT built yet.
 * Phase 0 ships only the data model (src/model/types.ts) and the pure
 * coordinate math (src/model/geometry.ts). See the roadmap in CLAUDE.md.
 */
export default function App() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-100 text-neutral-700">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">HomeMaker</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Phase 0 scaffold — data model &amp; coordinate math only. Editor coming
          in Phase 1.
        </p>
      </div>
    </div>
  );
}

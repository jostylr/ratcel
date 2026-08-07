# RiXCel

RiXCel is the standalone FormulaSheet editor for RiX. It uses exact RiX values,
reactive formula dependencies, tensor-aware views, and the versioned `.rixcel`
document format.

```sh
bun test
bun run build
python3 -m http.server 3000 --directory docs
```

The standalone milestone includes formula editing, assignment modes,
exact-value feedback, named tensor coordinates, local recovery, native
`.rixcel` open/save, CSV/TSV import/export, and document undo/redo. Version 2
documents are sparse event logs: edits store canonical executable RiX commands,
and undo/redo moves a cursor through that history. Imports and proposed edits
are preflighted in a restricted Web Worker that is terminated and replaced on
timeout. The shared runtime and widget protocol live in the sibling `rix`
repository.

Formula parse, cycle, and runtime failures are recoverable in place. The grid
marks affected cells, keeps their last committed values visible, and preserves
the failed source in the formula editor until it is corrected.

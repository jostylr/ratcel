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
and undo/redo moves a cursor through that history. Shift-selection supports
multi-cell clipboard paste; Command/Ctrl+D fills down and Command/Ctrl+R fills
right. Each paste or fill is one atomic `slot:batch` history event. Imported
FormulaSheet graphs remain sparse and materialize implicit null cells lazily.
The persistent graph and bounded visible-plane HTML projection live in a
restricted Web Worker; the main thread holds only the event log and interactive
DOM. Row and column window controls keep large logical sheets bounded to a
small rendered table. A timed-out worker is terminated, and the next complete
candidate log can reconstruct its session. The shared runtime and widget
protocol live in the sibling `rix` repository.

Formula parse, cycle, and runtime failures are recoverable in place. The grid
marks affected cells, keeps their last committed values visible, and preserves
the failed source in the formula editor until it is corrected.

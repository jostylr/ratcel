# RiXCel

RiXCel is the standalone FormulaSheet editor for RiX. It uses exact RiX values,
reactive formula dependencies, tensor-aware views, and the versioned `.rixcel`
document format.

```sh
bun test
bun run build
python3 -m http.server 3000 --directory docs
```

The first standalone milestone includes formula editing, assignment modes,
exact-value feedback, named tensor coordinates, local recovery, native
`.rixcel` open/save, CSV/TSV import/export, and document undo/redo. The shared
runtime and widget protocol live in the sibling `rix` repository.

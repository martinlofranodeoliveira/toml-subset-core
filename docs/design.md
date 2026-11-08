# Design — toml-subset-core

Single pass with an explicit current-table cursor; multiline strings
and arrays consume following lines until closed. Equal-sign search
skips quoted regions and bracket depth, so `=` inside strings never
splits a pair. Dotted keys build implicit (marked) tables that explicit
headers cannot reclaim — the round-trip test pins the legal shapes.

Oracle: values of every supported type, nesting/dotted/array-table
fixtures, one test per rejection, and a parse→stringify→parse fixed
point. Datetimes are the documented hole: rejected, never guessed.

# Plan-reader bench · 2026-10-18T03:29

model sonnet · hint: "A 2-bedroom apartment listing plan; the dimension labels are feet and inches."

| image | hint | path | ms | cost | rooms | doors/openings/windows | coverage | overlaps | score |
|---|---|---|---|---|---|---|---|---|---|
| desktop_2br.png | n | object | 7748 | $0.017 | 7 | 5/0/3 | 100% | 0 | 16/17 |
| desktop_2br.png | y | object | 8301 | $0.021 | 10 | 8/0/3 | 100% | 0 | 17/17 |
| two_bedroom_apartment.png | n | object | 6485 | $0.020 | 8 | 6/2/7 | 100% | 1 | 14/15 |
| two_bedroom_apartment.png | y | object | 6816 | $0.021 | 8 | 6/3/7 | 100% | 1 | 14/15 |
| wiki_2br_grove.jpg | n | object | 7148 | $0.019 | 11 | 6/0/3 | 76% | 1 | - |
| wiki_2br_grove.jpg | y | object | 6246 | $0.018 | 10 | 3/0/3 | 79% | 0 | - |
| wiki_2br_hk_poster.jpg | n | object | 9449 | $0.021 | 8 | 4/0/2 | 72% | 1 | - |
| wiki_2br_hk_poster.jpg | y | object | 6610 | $0.020 | 8 | 2/0/2 | 84% | 0 | - |
| wiki_2br_tyneside.png | n | object | 6352 | $0.018 | 7 | 6/0/3 | 80% | 0 | - |
| wiki_2br_tyneside.png | y | object | 7420 | $0.018 | 7 | 6/0/4 | 80% | 0 | - |

Total spend $0.1920. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:17 · before: single read, old prompt

model sonnet · reads 1 (the code before two reads existed) · repeat 3 · hint: "2 bedroom apartment, dimensions in feet"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 1 | object | 18475 | $0.020 | 10 | 10/1/4 | 73.5 | 100% | 0 | 16/17 | walled |
| desktop_2br.png | y | 2 | object | 25051 | $0.018 | 7 | 6/1/4 | 73.5 | 100% | 0 | 14/17 | walled |
| desktop_2br.png | y | 3 | object | 21539 | $0.022 | 12 | 11/1/5 | 84.6 | 99% | 0 | 16/17 | walled |

Spread over 3 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 3/3 | 7–12 | 73.5–84.6 | 0/3 open (walled, walled, walled) | 0/3 (rooms 1, areas 3, baths 3) |

Every read walled the kitchen off from the living room (no opening drawn; `connectRooms` then cut a 1.6 m cased hole in an invented wall), and 3 to 5 doors per read were invented by `connectRooms`. Baths column recomputed after fixing a reachability bug in the bench (all three reads reach both baths, via invented doors in two of them).

Total spend $0.0609. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:23 · after v1: two reads, open-plan prompt

model sonnet · reads 2 · repeat 3 · hint: "2 bedroom apartment, dimensions in feet"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 1 | object/b | 16196 | $0.046 | 8 | 6/1/4 | 76.0 | 99% | 0 | 15/17 | open |
| desktop_2br.png | y | 2 | object/a | 17066 | $0.046 | 9 | 9/1/4 | 72.5 | 97% | 2 | 15/17 | open |
| desktop_2br.png | y | 3 | object/b | 17003 | $0.045 | 8 | 7/1/3 | 76.6 | 100% | 0 | 16/17 | open |

Spread over 3 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 3/3 | 8–9 | 72.5–76.6 | 3/3 open (open, open, open) | 0/3 (rooms 3, areas 3, baths 0) |

Total spend $0.1367. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:25 · after v2: + reachability prompt, connectRooms joins unreachable groups

model sonnet · reads 2 · repeat 3 · hint: "2 bedroom apartment, dimensions in feet"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 1 | object/a | 13492 | $0.046 | 10 | 12/1/3 | 76.0 | 99% | 0 | 17/17 | open · MET |
| desktop_2br.png | y | 2 | object/b | 11410 | $0.048 | 8 | 7/2/3 | 74.2 | 100% | 0 | 16/17 | open · MET |
| desktop_2br.png | y | 3 | object/a | 15065 | $0.046 | 9 | 9/1/4 | 77.3 | 99% | 0 | 17/17 | open · MET |

Spread over 3 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 3/3 | 8–10 | 74.2–77.3 | 3/3 open (open, open, open) | 3/3 (rooms 3, areas 3, baths 3) |

Total spend $0.1402. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:25 · after v2: drawn sample, regression check

model sonnet · reads 2 · repeat 2 · hint: "2 bedroom apartment, dimensions in metres"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| two_bedroom_apartment.png | y | 1 | object/b | 9938 | $0.049 | 8 | 6/3/6 | 82.5 | 100% | 1 | 14/15 | - |
| two_bedroom_apartment.png | y | 2 | object/a | 10614 | $0.048 | 8 | 6/3/6 | 82.5 | 100% | 1 | 14/15 | - |

Spread over 2 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| two_bedroom_apartment.png | y | 2/2 | 8–8 | 82.5–82.5 | - | - |

Total spend $0.0971. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:25 · after v2, single read (prompt + connectRooms only)

model sonnet · reads 1 · repeat 3 · hint: "2 bedroom apartment, dimensions in feet"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 1 | object/a | 15523 | $0.025 | 11 | 10/2/4 | 71.9 | 99% | 0 | 16/17 | open · MET |
| desktop_2br.png | y | 2 | object/a | 10532 | $0.023 | 8 | 8/1/4 | 77.2 | 98% | 0 | 16/17 | walled |
| desktop_2br.png | y | 3 | object/a | 12006 | $0.024 | 10 | 9/2/4 | 74.4 | 97% | 0 | 15/17 | open · MET |

Spread over 3 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 3/3 | 8–11 | 71.9–77.2 | 2/3 open (open, walled, open) | 2/3 (rooms 3, areas 3, baths 3) |

Total spend $0.0722. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:27 · after v3 (final): two reads + walled-open-plan score term + closed-room guard

model sonnet · reads 2 · repeat 3 · hint: "2 bedroom apartment, dimensions in feet"

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 1 | object/b | 11789 | $0.046 | 9 | 7/2/4 | 87.3 | 99% | 0 | 16/17 | open · MET |
| desktop_2br.png | y | 2 | object/a | 13338 | $0.045 | 8 | 9/1/4 | 78.3 | 100% | 0 | 16/17 | open · MET |
| desktop_2br.png | y | 3 | object/a | 13823 | $0.049 | 11 | 10/2/3 | 76.0 | 99% | 0 | 16/17 | open · MET |

Spread over 3 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | y | 3/3 | 8–11 | 76.0–87.3 | 3/3 open (open, open, open) | 3/3 (rooms 3, areas 3, baths 3) |

Total spend $0.1397. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18T16:27 · after v3 (final), no hint

model sonnet · reads 2 · repeat 2 · hint: "A 2-bedroom apartment listing plan; the dimension labels are feet and inches."

| image | hint | run | path/chosen | ms | cost | rooms | doors/openings/windows | m² | coverage | overlaps | score | living↔kitchen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | n | 1 | object/b | 11121 | $0.046 | 8 | 6/2/4 | 78.7 | 100% | 0 | 15/17 | open · MET |
| desktop_2br.png | n | 2 | object/b | 10794 | $0.047 | 7 | 7/2/5 | 84.1 | 100% | 0 | 16/17 | open |

Spread over 2 runs:

| image | hint | ok | rooms | total m² | living↔kitchen | target (8–11 rooms, areas ±15 %, open, baths reachable) |
| --- | --- | --- | --- | --- | --- | --- |
| desktop_2br.png | n | 2/2 | 7–8 | 78.7–84.1 | 2/2 open (open, open) | 1/2 (rooms 1, areas 2, baths 2) |

Total spend $0.0936. Per-run JSON (loose + normalized plan + score lines) sits next to this file.

## 2026-10-18 · summary: open-plan boundaries and two reads

desktop_2br.png, hint "2 bedroom apartment, dimensions in feet", 3 runs each. Target: 3/3 runs with 8–11 rooms,
both bedrooms and the living room within 15 % of their printed areas, living open to the kitchen (no wall
pieces between them), both baths reachable from the front door.

| build | reads | rooms | total m² | living↔kitchen open | target met | cost / plan |
|---|---|---|---|---|---|---|
| before (old prompt, `connectRooms` cut a 1.6 m hole in an invented wall) | 1 | 7–12 | 73.5–84.6 | 0/3 | 0/3 | $0.020 |
| open-plan prompt + conservative `connectRooms`, single read | 1 | 8–11 | 71.9–77.2 | 2/3 | 2/3 | $0.024 |
| + two reads, scorer (v2) | 2 | 8–10 | 74.2–77.3 | 3/3 | 3/3 | $0.047 |
| + walled-open-plan score term, closed-room guard (final) | 2 | 8–11 | 76.0–87.3 | 3/3 | 3/3 | $0.047 |
| final, no hint (2 runs) | 2 | 7–8 | 78.7–84.1 | 2/2 | 1/2 (one 7-room read) | $0.047 |

The drawn sample (two_bedroom_apartment.png, 2 runs, two reads) is unchanged: 8 rooms, 82.5 m², 14/15 both
times; its one "overlap" is the bench's bounding-box check tripping on the L-shaped hall, as before.

Still wrong: the reader folds the Mech. and W/D closets into the hall "for simplicity" in about half the reads
(the laundry check fails), so the scorer's choice between a tidy 8-room read and a sloppier 10–11-room read
usually goes to the tidy one; the balcony door is rarely read (`connectRooms` adds it, with a note); one read
put the open boundary on living↔Bedroom 2 (now turned into a door by `normalizePlan`, with a note).

# Sample floor plans

Images the plan reader is benchmarked on (`npm run bench:extract`). Ground truth, where we have it, lives in
`shared/plan/samples.ts` (drawn samples) or in the labels printed on the image (`scripts/bench-extract.mjs`).

| file | what it is | source | licence / attribution |
|---|---|---|---|
| `two_bedroom_apartment.png` (+ `.svg`) | Drawn by `scripts/draw-plan.mjs` from `TWO_BED_APARTMENT`: 8 rooms, 16 openings, feet-and-inches labels. The ground-truth image. | this repo | ours |
| `desktop_2br.png` | A real rendered listing plan of a 2 bed / 2 bath apartment: Bedroom 1 11'5" x 17'1", Living/Dining 11'4" x 16'10", Bedroom 2 10'10" x 10'2", inset balcony 11'1" x 4'7", two baths, kitchen, W/D, mech. | screenshot supplied with the project brief | internal benchmark use only; not redistributed |
| `wiki_2br_grove.jpg` | "The Grove" 2-bedroom flat, 97 m²: a furnished colour rendering (living, dining, kitchen, 2 bedrooms, 2 T&B, maid's/utility, W/D, balcony). No dimension labels: tests the no-labels estimation path. 600×498. | https://commons.wikimedia.org/wiki/File:The_Grove_Floorplan_2_Bedroom_Flat_97_Sqm.jpg | CC BY-SA 4.0, Rockwell Land (via Wikimedia Commons) |
| `wiki_2br_hk_poster.jpg` | Photo of a show-flat poster: Greenview Villa (Hong Kong) Tower 2 Unit E two-bedroom plan, millimetre dimension strings, Chinese room labels, compass drawn, perspective and glare. A stress case. 1200×1600. | https://commons.wikimedia.org/wiki/File:HK_CSW_Greenview_Villa_綠悠雅苑_Showflat_示位_Tower_2_Unit_E_Two-bedroom_flat_floorplan_Jan-2013.jpg | CC BY-SA 3.0, Heanailee (via Wikimedia Commons) |
| `wiki_2br_tyneside.png` | The ground-floor (right-hand) flat cropped from Andy Dingley's illustrative Tyneside-flat pair: lounge, 2 bedrooms, kitchen, shower room, hallway, bay window, no dimension labels. Cropped with `sips` to 600×1080. | https://commons.wikimedia.org/wiki/File:Tyneside_flat_floorplan.png | CC BY-SA 4.0, Andy Dingley (via Wikimedia Commons) |

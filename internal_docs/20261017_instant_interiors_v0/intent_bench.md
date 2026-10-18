# Intent bench · 2026-10-18

35 utterances × 2 over two homes (bare, furnished) on TWO_BED_APARTMENT; checks are on the strict ops (expected op + key fields) plus exactly one short `say` last.

## haiku

| # | case | sentence | ok | first / done ms | ops | say |
|---|---|---|---|---|---|---|
| 1 | furnish: the living room | furnish the living room | pass | 913 / 971 | `furnish living` | Living room, furnished. |
| 2 | furnish: bedroom 2 scandinavian | furnish bedroom 2 scandinavian | pass | 932 / 1005 | `furnish bedroom_2 (scandinavian)` | Bedroom 2, Scandinavian and calm. |
| 3 | furnish: the whole place | furnish the whole place | pass | 876 / 925 | `furnish all` | Every room, furnished. |
| 4 | place: sofa on the north wall | put a sofa against the north wall | pass | 2246 / 2311 | `place sofa @{"room":"living","where":"wall","wall":"north"}` | Sofa against the north wall. |
| 5 | place: dining set | a dining table with four chairs | pass | 852 / 982 | `place dining_table @{"where":"center"} + place dining_chair×4 @{"where":"near","of":{"kind":"dining_table","room":"living"}}` | Dining table with four chairs. |
| 6 | place: side table right there | put a side table right there | pass | 1466 / 1467 | `place side_table @{"where":"gaze"}` | A side table, right there. |
| 7 | place: pendant over the island | hang a pendant over the kitchen island | pass | 732 / 757 | `place pendant @{"where":"near","of":{"kind":"island","room":"kitchen"},"side":"on"}` | A pendant over the island. |
| 8 | surface: paint the walls sage | paint the walls sage | pass | 793 / 850 | `surface living walls {"color":"#9caf88","pattern":"plain"}` | Sage walls in the living room. |
| 9 | surface: herringbone oak everywhere | make the floors herringbone oak everywhere | pass | 878 / 898 | `surface all floor {"color":"#a67f5c","pattern":"herringbone"}` | Herringbone oak, every room. |
| 10 | surface: wallpaper the primary floral | wallpaper the primary bedroom in a soft green floral | pass | 776 / 832 | `surface primary walls {"color":"#dfe7d6","pattern":"floral","accent":"#7a9a6a"}` | A soft green floral in the primary bedroom. |
| 11 | surface: kitchen floor checkerboard | give the kitchen a black and white checkerboard floor | pass | 855 / 869 | `surface kitchen floor {"color":"#f4f4f2","pattern":"checker","accent":"#1f1f22"}` | Black and white checkerboard in the kitchen. |
| 12 | light: nighttime | nighttime | pass | 868 / 869 | `light night lamps true` | Night falls; the lamps come on. |
| 13 | light: sunset question | what would it look like at sunset? | pass | 839 / 851 | `light golden` | Golden hour. |
| 14 | goto: the kitchen | take me to the kitchen | pass | 668 / 671 | `goto kitchen` | To the kitchen. |
| 15 | say: how big is the living room | how big is the living room? | pass | 702 / 728 | `no ops` | About 5.5 by 4.5 metres, windows north and west. |
| 16 | reset: start over | start over | pass | 721 / 749 | `reset` | Clean slate, back to the start. |
| 17 | move: sofa under the window | move the sofa under the window | pass | 872 / 873 | `move {"kind":"sofa","room":"living"} → {"room":"living","where":"window","facing":"room"}` | Sofa under the window. |
| 18 | move: armchairs by the window | put the armchairs by the window | pass | 723 / 748 | `move {"kind":"armchair","room":"living"} → {"where":"window","facing":"room"}` | Armchairs by the window. |
| 19 | ref: lamp next to it (gaze sofa) | put a lamp next to it | pass | 834 / 835 | `place floor_lamp @{"where":"near","of":{"ref":"gaze"},"side":"beside"}` | A floor lamp beside the sofa. |
| 20 | ref: I don't like this chair (gaze) | I don't like this chair | pass | 842 / 846 | `remove {"ref":"gaze"}` | The chair is gone. |
| 21 | swap: rug for a blue one | swap the rug for a blue one | pass | 729 / 857 | `restyle {"kind":"rug","room":"living"} {"color":"#3a6fc0"}` | A blue rug instead. |
| 22 | restyle: sofa green velvet | make the sofa green velvet | pass | 826 / 832 | `restyle {"kind":"sofa","room":"living"} {"color":"#2f5d3a","material":"velvet"}` | Green velvet sofa. |
| 23 | restyle: a bigger bed | a bigger bed | pass | 713 / 753 | `restyle {"kind":"bed","room":"primary"} {"scale":1.25} rel` | A bigger bed. |
| 24 | remove: all the plants | remove all the plants | pass | 834 / 835 | `remove {"ref":"all","tag":"plant"}` | Every plant gone. |
| 25 | remove: get rid of the tv | get rid of the tv | pass | 715 / 749 | `remove {"kind":"tv","room":"living"}` | The TV is gone. |
| 26 | remove: clear the living room | clear the living room | pass | 709 / 733 | `remove {"ref":"all","room":"living"}` | Living room cleared. |
| 27 | place: two armchairs across from the sofa | two armchairs across from the sofa | pass | 822 / 874 | `place armchair×2 @{"where":"near","of":{"kind":"sofa","room":"living"},"side":"opposite"}` | Two armchairs across from the sofa. |
| 28 | place: picture above the bed | hang a picture above the bed | pass | 788 / 820 | `place picture @{"where":"near","of":{"kind":"bed","room":"primary"},"side":"behind"}` | A picture above the bed. |
| 29 | light: too dark in here | it's too dark in here | pass | 623 / 649 | `light lamps true warmth 0.7` | Lamps on. |
| 30 | light: turn off the lamps | turn off the lamps | pass | 822 / 823 | `light lamps false` | Lamps off. |
| 31 | light: make it cozy | make it cozy in here | pass | 1013 / 1014 | `light lamps true warmth 0.9` | Warm light, lamps on. |
| 32 | undo | undo | pass | 638 / 773 | `undo` | Undone. |
| 33 | goto: the sofa | take me to the sofa | pass | 775 / 808 | `goto {"kind":"sofa","room":"living"}` | To the sofa. |
| 34 | style: make it mid-century | make it mid-century | pass | 790 / 1050 | `surface living walls {"color":"#efe6d6","pattern":"plain"} + surface living floor {"color":"#9a6a44","pattern":"plank"} + restyle {"tag":"seating","room":"living"} {"color":"#c9742b","trim":"#5a3a22","material":"leather"}` | Mid-century: warm walls, oak floor, tan leather. |
| 35 | style: furnish empty bedroom 2 japandi | make bedroom 2 japandi | pass | 713 / 745 | `furnish bedroom_2 (japandi)` | Bedroom 2, Japandi and calm. |
| 36 | furnish: the living room | furnish the living room | pass | 817 / 854 | `furnish living` | Living room, furnished. |
| 37 | furnish: bedroom 2 scandinavian | furnish bedroom 2 scandinavian | pass | 716 / 745 | `furnish bedroom_2 (scandinavian)` | Bedroom 2, Scandinavian and calm. |
| 38 | furnish: the whole place | furnish the whole place | pass | 719 / 775 | `furnish all` | Every room, furnished. |
| 39 | place: sofa on the north wall | put a sofa against the north wall | pass | 2139 / 2160 | `place sofa @{"room":"living","where":"wall","wall":"north"}` | Sofa against the north wall. |
| 40 | place: dining set | a dining table with four chairs | pass | 1142 / 1306 | `place dining_table @{"room":"living","where":"center"} + place dining_chair×4 @{"where":"near","of":{"kind":"dining_table","room":"living"}}` | A dining table with four chairs. |
| 41 | place: side table right there | put a side table right there | pass | 736 / 770 | `place side_table @{"where":"gaze"}` | A side table, right there. |
| 42 | place: pendant over the island | hang a pendant over the kitchen island | pass | 796 / 817 | `place pendant @{"where":"near","of":{"kind":"island","room":"kitchen"},"side":"on"}` | A pendant over the island. |
| 43 | surface: paint the walls sage | paint the walls sage | pass | 1003 / 1027 | `surface living walls {"color":"#9caf88","pattern":"plain"}` | Sage walls in the living room. |
| 44 | surface: herringbone oak everywhere | make the floors herringbone oak everywhere | pass | 769 / 779 | `surface all floor {"color":"#a67f5c","pattern":"herringbone"}` | Herringbone oak, every room. |
| 45 | surface: wallpaper the primary floral | wallpaper the primary bedroom in a soft green floral | pass | 776 / 824 | `surface primary walls {"color":"#dfe7d6","pattern":"floral","accent":"#7a9a6a"}` | A soft green floral in the primary bedroom. |
| 46 | surface: kitchen floor checkerboard | give the kitchen a black and white checkerboard floor | pass | 1018 / 1189 | `surface kitchen floor {"color":"#f4f4f2","pattern":"checker","accent":"#1f1f22"}` | Black and white checkerboard in the kitchen. |
| 47 | light: nighttime | nighttime | pass | 776 / 777 | `light night lamps true` | Night falls; the lamps come on. |
| 48 | light: sunset question | what would it look like at sunset? | pass | 743 / 744 | `light golden` | Golden hour. |
| 49 | goto: the kitchen | take me to the kitchen | pass | 769 / 886 | `goto kitchen` | To the kitchen. |
| 50 | say: how big is the living room | how big is the living room? | pass | 734 / 757 | `no ops` | About 5.5 by 4.5 metres, windows north and west. |
| 51 | reset: start over | start over | pass | 719 / 731 | `reset` | Fresh start. |
| 52 | move: sofa under the window | move the sofa under the window | pass | 864 / 892 | `move {"kind":"sofa","room":"living"} → {"room":"living","where":"window","facing":"room"}` | Sofa under the window. |
| 53 | move: armchairs by the window | put the armchairs by the window | pass | 748 / 861 | `move {"kind":"armchair","room":"living"} → {"where":"window","facing":"room"}` | Armchairs by the window. |
| 54 | ref: lamp next to it (gaze sofa) | put a lamp next to it | pass | 839 / 883 | `place floor_lamp @{"where":"near","of":{"ref":"gaze"},"side":"beside"}` | A floor lamp beside the sofa. |
| 55 | ref: I don't like this chair (gaze) | I don't like this chair | pass | 677 / 709 | `remove {"ref":"gaze"}` | The chair is gone. |
| 56 | swap: rug for a blue one | swap the rug for a blue one | pass | 768 / 809 | `restyle {"kind":"rug","room":"living"} {"color":"#3a6fc0"}` | A blue rug instead. |
| 57 | restyle: sofa green velvet | make the sofa green velvet | pass | 838 / 870 | `restyle {"kind":"sofa","room":"living"} {"color":"#2f5d3a","material":"velvet"}` | Green velvet sofa. |
| 58 | restyle: a bigger bed | a bigger bed | pass | 700 / 821 | `restyle {"kind":"bed","room":"primary"} {"scale":1.25} rel` | A bigger bed. |
| 59 | remove: all the plants | remove all the plants | pass | 683 / 685 | `remove {"ref":"all","tag":"plant"}` | Every plant gone. |
| 60 | remove: get rid of the tv | get rid of the tv | pass | 759 / 760 | `remove {"kind":"tv","room":"living"}` | The TV is gone. |
| 61 | remove: clear the living room | clear the living room | pass | 670 / 691 | `remove {"ref":"all","room":"living"}` | Living room cleared. |
| 62 | place: two armchairs across from the sofa | two armchairs across from the sofa | pass | 857 / 905 | `place armchair×2 @{"where":"near","of":{"kind":"sofa","room":"living"},"side":"opposite"}` | Two armchairs across from the sofa. |
| 63 | place: picture above the bed | hang a picture above the bed | pass | 844 / 845 | `place picture @{"where":"near","of":{"kind":"bed","room":"primary"},"side":"behind"}` | A picture above the bed. |
| 64 | light: too dark in here | it's too dark in here | pass | 1054 / 1091 | `light lamps true warmth 0.7` | Lamps on. |
| 65 | light: turn off the lamps | turn off the lamps | pass | 692 / 737 | `light lamps false` | Lamps off. |
| 66 | light: make it cozy | make it cozy in here | pass | 846 / 847 | `light lamps true warmth 0.9` | Warm light, lamps on. |
| 67 | undo | undo | pass | 1198 / 1230 | `undo` | Undone. |
| 68 | goto: the sofa | take me to the sofa | pass | 708 / 811 | `goto {"kind":"sofa","room":"living"}` | To the sofa. |
| 69 | style: make it mid-century | make it mid-century | pass | 1306 / 1588 | `surface living walls {"color":"#efe6d6","pattern":"plain"} + surface living floor {"color":"#9a6a44","pattern":"plank"} + restyle {"tag":"seating","room":"living"} {"color":"#c9742b","trim":"#5a3a22","material":"leather"}` | Mid-century: warm walls, oak floor, tan leather. |
| 70 | style: furnish empty bedroom 2 japandi | make bedroom 2 japandi | pass | 724 / 755 | `furnish bedroom_2 (japandi)` | Bedroom 2, Japandi and calm. |

**haiku: 70/70 pass (100%) · first op median 790 ms, p90 1018 ms · done median 835 ms, p90 1091 ms · cost $0.0138 ($0.00020/call) · cache hits 66/70 · provider anthropic**


## Notes

- First pass of the digest scored 34/35 (97%): "make it mid-century" on a furnished room added a `furnish` on top of the surfaces + restyle. The Styles line now says a room with things in it never gets a furnish unless the sentence asks for furniture; the dining-set rule now anchors the chairs on the table. Second run (above): 70/70.
- `?model=sonnet` for comparison, same cases once: **35/35 pass · first op median 1087 ms, p90 1341 ms · done median 1128 ms · $0.1483 ($0.00424/call, ~20× Haiku) · cache hits 31/35**. Haiku stays the default.
- Digest ≈ 4.5k tokens, cached (cache hits 66/70; the misses are the first call per worker and the two runs right after a digest edit). A typical context block is ~900 chars for 8 rooms and 25 items.
- Left as is: `dining_chair ×4` comes back anchored on the table but without `arrange: "around"`; the kernel's default for a count with no arrangement should be "around" when the anchor is a table.

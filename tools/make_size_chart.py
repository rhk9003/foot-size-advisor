"""產生商品頁用的尺碼對照表圖片。

資料直接讀 data/sizes/<sku>.json，跟網頁工具用同一份，數字不會對不上。
用法：python tools/make_size_chart.py 11802053
輸出：size-chart/<family 或 sku>.png（寬 1000px，91APP 商品說明圖常用寬度）
字型：Noto Sans TC（SIL Open Font License，商用可用）
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = Path(r"C:\Windows\Fonts\NotoSansTC-VF.ttf")

W = 1000
TAUPE = (168, 154, 140)       # DK 商品說明圖的暖灰棕
TAUPE_DARK = (92, 80, 70)
TAUPE_LIGHT = (239, 233, 227)
ROW_ALT = (250, 247, 244)
LINE = (226, 218, 210)
INK = (51, 45, 41)
WHITE = (255, 255, 255)


def font(size, weight=400):
    f = ImageFont.truetype(str(FONT_PATH), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def text_center(draw, box, text, fnt, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=fnt)
    draw.text((x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t)) / 2 - t), text, font=fnt, fill=fill)


def width_limit(chart, s):
    rule = chart.get("width_rule") or {}
    if not rule.get("enabled") or not isinstance(s.get("shoe_width"), (int, float)):
        return None
    return f"{(s['shoe_width'] - 1) / 10:.1f} 以下"


def build(sku):
    chart = json.loads((ROOT / f"data/sizes/{sku}.json").read_text(encoding="utf-8"))
    sizes = sorted(chart["sizes"], key=lambda s: s["foot_min"])
    has_width = any(width_limit(chart, s) for s in sizes)

    headers = ["尺碼", "適合腳長 (cm)"] + (["適合腳寬 (cm)"] if has_width else [])
    col_w = [220, 330, 290] if has_width else [320, 520]
    table_x = (W - sum(col_w)) // 2
    head_h, row_h = 80, 74

    notes = [
        "腳長接近上限，或腳寬超過時，建議選大一號。",
        "左右腳大小不同時，以大的那隻為準。",
        "量腳長：腳跟貼牆，量牆到最長腳趾前端的距離。",
    ]

    band_h = 190
    product_h = 110
    table_h = head_h + row_h * len(sizes)
    note_line_h = 50
    notes_h = 40 + note_line_h * len(notes) + 30
    H = band_h + product_h + table_h + 50 + notes_h + 60

    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    # 標題帶
    d.rectangle([0, 0, W, band_h], fill=TAUPE)
    text_center(d, (0, 34, W, 120), "尺碼對照表", font(64, 700), WHITE)
    text_center(d, (0, 118, W, 160), "S I Z E   C H A R T", font(26, 500), WHITE)

    # 商品名稱
    name = chart.get("family_name") or chart["name"]
    text_center(d, (40, band_h + 20, W - 40, band_h + product_h - 10), name, font(32, 600), INK)

    # 表格
    y = band_h + product_h
    d.rectangle([table_x, y, table_x + sum(col_w), y + head_h], fill=TAUPE_LIGHT)
    x = table_x
    for i, htext in enumerate(headers):
        text_center(d, (x, y, x + col_w[i], y + head_h), htext, font(30, 700), TAUPE_DARK)
        x += col_w[i]
    y += head_h
    for r, s in enumerate(sizes):
        if r % 2 == 1:
            d.rectangle([table_x, y, table_x + sum(col_w), y + row_h], fill=ROW_ALT)
        cells = [s["label"], f"{s['foot_min'] / 10:.1f} ~ {s['foot_max'] / 10:.1f}"]
        if has_width:
            cells.append(width_limit(chart, s) or "-")
        x = table_x
        for i, ctext in enumerate(cells):
            text_center(d, (x, y, x + col_w[i], y + row_h), ctext, font(32, 700 if i == 0 else 400), INK)
            x += col_w[i]
        d.line([table_x, y + row_h, table_x + sum(col_w), y + row_h], fill=LINE, width=2)
        y += row_h
    # 外框與直線
    top = band_h + product_h
    d.rectangle([table_x, top, table_x + sum(col_w), y], outline=LINE, width=2)
    x = table_x
    for cw in col_w[:-1]:
        x += cw
        d.line([x, top, x, y], fill=LINE, width=2)

    # 說明
    y += 50
    box = [table_x, y, table_x + sum(col_w), y + notes_h]
    d.rounded_rectangle(box, radius=18, fill=(247, 243, 239))
    ny = y + 40
    for n in notes:
        d.ellipse([table_x + 34, ny + 16, table_x + 46, ny + 28], fill=TAUPE)
        d.text((table_x + 62, ny), n, font=font(28, 400), fill=TAUPE_DARK)
        ny += note_line_h

    out_dir = ROOT / "size-chart"
    out_dir.mkdir(exist_ok=True)
    family = (chart.get("family_name") or sku).split()[-1]
    out = out_dir / f"{family}_尺碼對照表.png"
    img.save(out, optimize=True)
    return out


if __name__ == "__main__":
    for sku in sys.argv[1:] or ["11802053"]:
        print(build(sku))

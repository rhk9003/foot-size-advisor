"""產生商品頁用的「拍照選尺碼」按鈕圖，上架時把整張圖設成超連結到工具。

用法：python tools/make_cta_banner.py
輸出：size-chart/拍照選尺碼按鈕.png 與 .jpg（寬 1000px）
字型：Noto Sans TC（SIL Open Font License，商用可用）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = Path(r"C:\Windows\Fonts\NotoSansTC-VF.ttf")

W, H = 1000, 420
PANEL = (247, 243, 239)
INK = (51, 45, 41)
SUB = (92, 80, 70)
BRAND = (255, 83, 83)
WHITE = (255, 255, 255)
PHONE = (47, 47, 47)
FLOOR = (107, 90, 78)
SKIN = (242, 201, 165)
SKIN_LINE = (201, 143, 104)


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


def build():
    scale = 2  # 先畫兩倍大再縮小，邊緣比較平滑
    img = Image.new("RGB", (W * scale, H * scale), WHITE)
    d = ImageDraw.Draw(img)
    S = lambda *v: [x * scale for x in v]

    d.rounded_rectangle(S(40, 30, 960, 390), radius=28 * scale, fill=PANEL)

    # 手機裡是一張 A4 紙和一隻腳
    d.rounded_rectangle(S(100, 62, 290, 358), radius=26 * scale, fill=PHONE)
    d.rounded_rectangle(S(114, 90, 276, 330), radius=8 * scale, fill=FLOOR)
    d.rectangle(S(145, 118, 245, 259), fill=WHITE)
    d.ellipse(S(168, 150, 222, 262), fill=SKIN, outline=SKIN_LINE, width=3 * scale)
    for x, y, dx, dy in [(137, 110, 1, 1), (253, 110, -1, 1), (253, 267, -1, -1), (137, 267, 1, -1)]:
        d.line(S(x, y, x + 22 * dx, y), fill=BRAND, width=5 * scale)
        d.line(S(x, y, x, y + 22 * dy), fill=BRAND, width=5 * scale)
    d.ellipse(S(178, 282, 212, 316), fill=(39, 174, 96))
    d.line(S(186, 299, 193, 306), fill=WHITE, width=4 * scale)
    d.line(S(193, 306, 205, 292), fill=WHITE, width=4 * scale)

    # 文字與按鈕
    d.text(S(350, 70), "先量再買，更貼合！", font=font(54 * scale, 700), fill=INK)
    d.text(S(352, 158), "腳踩 A4 紙拍一張照，馬上幫你選對尺碼", font=font(30 * scale, 400), fill=SUB)
    d.rounded_rectangle(S(350, 240, 910, 336), radius=48 * scale, fill=BRAND)
    text_center(d, S(350, 240, 910, 336), "點我拍照選尺碼　›", font(40 * scale, 700), WHITE)

    img = img.resize((W, H), Image.LANCZOS)
    out_dir = ROOT / "size-chart"
    out_dir.mkdir(exist_ok=True)
    png = out_dir / "拍照選尺碼按鈕.png"
    jpg = out_dir / "拍照選尺碼按鈕.jpg"
    img.save(png, optimize=True)
    # 商品頁用 JPG：不做色度抽樣，紅底白字才不會糊
    img.save(jpg, quality=94, subsampling=0, optimize=True)
    return png, jpg


if __name__ == "__main__":
    for f in build():
        print(f)

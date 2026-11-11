from pathlib import Path
from PIL import Image

root = Path(__file__).parent
width, height = 2101, 33
palette = [(255, 0, 0), (0, 192, 0), (0, 0, 255), (255, 255, 0), (7, 17, 29), (249, 241, 229)]
rgb = Image.new('RGB', (width, height))
rgb.putdata([palette[((x // 7) if x < 120 else (x // 503 + y // 17)) % len(palette)]
             for y in range(height) for x in range(width)])
rgba = rgb.convert('RGBA')
rgba.putalpha(Image.frombytes('L', (width, height), bytes(
    255 if x % 3 else 96 for y in range(height) for x in range(width))))
for mode, image in [('rgb', rgb), ('alpha', rgba)]:
    image.save(root / f'wide-{mode}.tiff', compression='raw')
    image.save(root / f'wide-{mode}-reference.png')

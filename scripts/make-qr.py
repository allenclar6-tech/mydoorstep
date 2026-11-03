#!/usr/bin/env python3
"""Makes a QR code SVG (byte mode, error correction M, versions 1-6) with no extra libraries.

Used for the DOORSTEP download page:  python3 scripts/make-qr.py https://mydoorstep.com.co/download public/download-qr.svg
Follows the QR Code standard (ISO/IEC 18004); the output was checked by scanning it with OpenCV.
"""
import sys

# Error correction level M: (ec codewords per block, number of blocks, data codewords per block) for versions 1-6.
TABLE_M = {1: (10, 1, 16), 2: (16, 1, 28), 3: (26, 1, 44), 4: (18, 2, 32), 5: (24, 2, 43), 6: (16, 4, 27)}
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}


def gf_mul(x, y):
    z = 0
    for i in range(7, -1, -1):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z & 0xFF


def rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = gf_mul(root, 0x02)
    return result


def rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= gf_mul(coef, factor)
    return result


def encode(text):
    payload = text.encode('utf-8')
    for version in range(1, 7):
        ec_len, blocks, data_len = TABLE_M[version]
        capacity = blocks * data_len
        if 4 + 8 + len(payload) * 8 <= capacity * 8:
            break
    else:
        raise ValueError('Text too long for this small encoder (max version 6).')
    bits = [0, 1, 0, 0] + [(len(payload) >> i) & 1 for i in range(7, -1, -1)]
    for byte in payload:
        bits += [(byte >> i) & 1 for i in range(7, -1, -1)]
    bits += [0] * min(4, capacity * 8 - len(bits))
    bits += [0] * (-len(bits) % 8)
    data = [int(''.join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = [0xEC, 0x11]
    while len(data) < capacity:
        data.append(pad[(len(data) - len(bits) // 8) % 2])
    divisor = rs_divisor(ec_len)
    chunks = [data[i * data_len:(i + 1) * data_len] for i in range(blocks)]
    ecc = [rs_remainder(chunk, divisor) for chunk in chunks]
    codewords = [chunk[i] for i in range(data_len) for chunk in chunks] + [block[i] for i in range(ec_len) for block in ecc]
    return version, codewords


def build(text):
    version, codewords = encode(text)
    size = version * 4 + 17
    modules = [[False] * size for _ in range(size)]
    function = [[False] * size for _ in range(size)]

    def setf(x, y, dark):
        modules[y][x] = dark
        function[y][x] = True

    for i in range(size):  # timing patterns
        setf(6, i, i % 2 == 0)
        setf(i, 6, i % 2 == 0)
    for cx, cy in [(3, 3), (size - 4, 3), (3, size - 4)]:  # finder patterns + separators
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                x, y = cx + dx, cy + dy
                if 0 <= x < size and 0 <= y < size:
                    dist = max(abs(dx), abs(dy))
                    setf(x, y, dist not in (2, 4))
    positions = ALIGN[version]
    for i, ax in enumerate(positions):  # alignment patterns
        for j, ay in enumerate(positions):
            if (i == 0 and j == 0) or (i == 0 and j == len(positions) - 1) or (i == len(positions) - 1 and j == 0):
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    setf(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)

    def draw_format(mask):
        data = (0 << 3) | mask  # level M = 0b00
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = ((data << 10) | rem) ^ 0x5412
        bit = lambda i: (bits >> i) & 1 == 1
        for i in range(6):
            setf(8, i, bit(i))
        setf(8, 7, bit(6)); setf(8, 8, bit(7)); setf(7, 8, bit(8))
        for i in range(9, 15):
            setf(14 - i, 8, bit(i))
        for i in range(8):
            setf(size - 1 - i, 8, bit(i))
        for i in range(8, 15):
            setf(8, size - 15 + i, bit(i))
        setf(8, size - 8, True)  # dark module

    draw_format(0)  # reserve the format areas before placing data
    i = 0
    total = len(codewords) * 8
    right = size - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(size):
            for j in range(2):
                x = right - j
                upward = ((right + 1) & 2) == 0
                y = size - 1 - vert if upward else vert
                if not function[y][x] and i < total:
                    modules[y][x] = (codewords[i >> 3] >> (7 - (i & 7))) & 1 == 1
                    i += 1
        right -= 2

    masks = [
        lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0, lambda x, y: (x + y) % 3 == 0,
        lambda x, y: (x // 3 + y // 2) % 2 == 0, lambda x, y: x * y % 2 + x * y % 3 == 0,
        lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0, lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
    ]

    def apply(mask):
        for y in range(size):
            for x in range(size):
                if not function[y][x] and masks[mask](x, y):
                    modules[y][x] = not modules[y][x]

    def penalty():
        score = 0
        lines = [row[:] for row in modules] + [[modules[y][x] for y in range(size)] for x in range(size)]
        for line in lines:  # runs of 5+ and finder-like patterns
            run = 1
            for k in range(1, size):
                if line[k] == line[k - 1]:
                    run += 1
                else:
                    if run >= 5:
                        score += run - 2
                    run = 1
            if run >= 5:
                score += run - 2
            text = ''.join('1' if v else '0' for v in line)
            score += 40 * (text.count('10111010000') + text.count('00001011101'))
        for y in range(size - 1):  # 2x2 blocks
            for x in range(size - 1):
                if modules[y][x] == modules[y][x + 1] == modules[y + 1][x] == modules[y + 1][x + 1]:
                    score += 3
        dark = sum(sum(row) for row in modules)
        score += (abs(dark * 20 - size * size * 10) // (size * size)) * 10
        return score

    best = None
    for mask in range(8):
        apply(mask); draw_format(mask)
        score = penalty()
        if best is None or score < best[0]:
            best = (score, mask)
        apply(mask)  # undo (XOR)
    apply(best[1]); draw_format(best[1])
    return modules


def svg(modules, border=4, dark='#123d2d'):
    size = len(modules) + border * 2
    path = ''.join(f'M{x + border},{y + border}h1v1h-1z' for y, row in enumerate(modules) for x, v in enumerate(row) if v)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
            f'<rect width="{size}" height="{size}" fill="#ffffff"/><path d="{path}" fill="{dark}"/></svg>\n')


if __name__ == '__main__':
    text, out = sys.argv[1], sys.argv[2]
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write(svg(build(text)))
    print(f'Wrote {out} for {text}')

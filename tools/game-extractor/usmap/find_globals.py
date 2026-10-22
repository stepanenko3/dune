"""Шукає FNamePool і GUObjectArray у пам'яті живого (замороженого) UE 5.2 процесу на Linux x86-64.

Використання: python3 -I find_globals.py <pid>
Вивід — один JSON-рядок {"fnamePool": "0x…", "guobjectArray": "0x…", "imageBase": "0x…"};
нема рівно одного кандидата кожного — код 2, кандидати в stderr.
"""
import json
import re
import struct
import sys

EXE = 'DuneSandboxServer'


def main(pid):
    maps = open(f'/proc/{pid}/maps').read().splitlines()
    mem = open(f'/proc/{pid}/mem', 'rb', 0)

    def read(addr, n):
        try:
            mem.seek(addr)
            return mem.read(n)
        except OSError:
            return None

    # rw-сегменти самого бінарника + анонімний .bss одразу після них; база образу — перший сегмент бінарника
    regions, exe_rw_end, base = [], None, None
    for line in maps:
        m = re.match(r'([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)', line)
        a, b, perm, path = int(m[1], 16), int(m[2], 16), m[3], m[4]
        if EXE in path and base is None:
            base = a
        if EXE in path and perm.startswith('rw'):
            regions.append((a, b))
            exe_rw_end = b
        elif exe_rw_end is not None and a == exe_rw_end and not path and perm.startswith('rw'):
            regions.append((a, b))
            exe_rw_end = b

    def is_ptr(p):
        return 0x10000 < p < 0x7fffffffffff and p % 8 == 0

    fname, guobj = [], []
    for a, b in regions:
        data = read(a, b - a)
        if not data:
            continue
        for off in range(0, len(data) - 64, 8):
            p = struct.unpack_from('<Q', data, off)[0]
            if is_ptr(p):
                head = read(p, 32)
                # Blocks[0] пулу імен: перший запис — «None», за ним «ByteProperty»; Blocks — на зсуві 0x40 у FNamePool (FRWLock pthread 56 Б + 2×uint32)
                if head and head[2:6] == b'None' and b'ByteProperty' in head[6:24]:
                    fname.append(a + off - 0x40)
            # FChunkedFixedUObjectArray на зсуві 16 у FUObjectArray
            if off >= 16:
                objs = struct.unpack_from('<Q', data, off)[0]
                mx, num, mxc, numc = struct.unpack_from('<iiii', data, off + 16)
                if is_ptr(objs) and 10000 < num <= mx < 1 << 26 and mxc == -(-mx // 65536) and numc == -(-num // 65536):
                    guobj.append(a + off - 16)

    if len(fname) != 1 or len(guobj) != 1 or base is None:
        print(f'кандидати FNamePool: {[hex(x) for x in fname]}, GUObjectArray: {[hex(x) for x in guobj]}, база: {base}', file=sys.stderr)
        sys.exit(2)
    print(json.dumps({'fnamePool': hex(fname[0]), 'guobjectArray': hex(guobj[0]), 'imageBase': hex(base)}))


if __name__ == '__main__':
    main(int(sys.argv[1]))

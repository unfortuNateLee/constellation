// Swift port of d3-force's seeded pseudo-random source (src/lcg.js).
//
// Ported from d3-force (v3) by Mike Bostock — https://github.com/d3/d3-force
//
// ISC License. Copyright 2010-2023 Mike Bostock.
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
// REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
// AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
// INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
// LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
// OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
// PERFORMANCE OF THIS SOFTWARE.

/// The exact linear congruential generator d3-force seeds once per simulation
/// and shares across the link, many-body, and collide forces for "jiggle"
/// (deterministic tie-breaking of coincident points). Parameters match
/// `lcg.js` byte-for-byte (a = 1664525, c = 1013904223, m = 2³², seed = 1).
///
/// All arithmetic stays exact in `Double`: `a·s + c ≤ 1664525·(2³²−1) + c`,
/// which is below 2⁵³, so no precision is lost; JS's `%` maps to
/// `truncatingRemainder`, and both engines divide by the same `m`. This is the
/// key to tick-level numeric parity — the jiggle stream must be consumed in the
/// identical order the ported forces traverse the quadtree.
///
/// Not `Sendable`: a mutable seed used single-threaded from the simulation.
final class D3Random {
    private var s: Double = 1
    private let a: Double = 1664525
    private let c: Double = 1013904223
    private let m: Double = 4294967296  // 2^32

    /// `() => (s = (a * s + c) % m) / m`
    func next() -> Double {
        s = (a * s + c).truncatingRemainder(dividingBy: m)
        return s / m
    }

    /// Resets the stream to the seed (mirrors constructing a fresh `lcg()`).
    func reset() {
        s = 1
    }
}

/// `jiggle.js`: `(random() - 0.5) * 1e-6`.
@inline(__always)
func jiggle(_ random: D3Random) -> Double {
    (random.next() - 0.5) * 1e-6
}

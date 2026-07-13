// Port of ContactRecord.assignStableId + FNV-1a/base36 hash (js/contact-record.js:149-179).
//
// Assigns a deterministic id from a contact's UID (preferred) or display name,
// so the same source contact yields the same id across reparses. The allocator
// owns the per-parse accumulators (`usedIds`, `basisCounts`) so duplicate-named
// UID-less contacts get a stable occurrence suffix (#2, #3, …) in file order
// rather than colliding. IDs are byte-identical to the Node implementation.

import Foundation

/// Per-parse accumulator that hands out stable, collision-free contact ids.
public struct StableIDAllocator {
    private var usedIds: Set<String> = []
    private var basisCounts: [String: Int] = [:]

    public init() {}

    /// Assign and return a stable id for a contact identified by `uid` (preferred)
    /// or display name `fn`. Mutates internal accumulators for uniqueness.
    public mutating func assign(uid: String?, fn: String) -> String {
        // JS truthiness: a non-nil, non-empty uid selects the uid basis.
        let base: String
        if let uid, !uid.isEmpty {
            base = "uid:" + trimmed(uid)
        } else {
            base = "fn:" + trimmed(fn).lowercased()
        }

        let occurrence = (basisCounts[base] ?? 0) + 1
        basisCounts[base] = occurrence
        let basis = occurrence == 1 ? base : "\(base)#\(occurrence)"

        var id = "c_" + StableID.hash(basis)
        var probe = 0
        while usedIds.contains(id) {
            probe += 1
            id = "c_" + StableID.hash("\(basis)~\(probe)")
        }
        usedIds.insert(id)
        return id
    }

    private func trimmed(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public enum StableID {
    /// FNV-1a 32-bit hash → lowercase base36 (js/contact-record.js `_hash`).
    /// Iterates UTF-16 code units to match JS `charCodeAt` / `String.length`.
    public static func hash(_ str: String) -> String {
        var h: UInt32 = 0x811c_9dc5
        for unit in str.utf16 {
            h ^= UInt32(unit)
            h = h &* 0x0100_0193 // Math.imul: 32-bit wrapping multiply
        }
        return String(h, radix: 36)
    }
}

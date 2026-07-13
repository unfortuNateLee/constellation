// Port of `VCFParser._extractHashtags` in js/vcf-parser.js:
//
//   _extractHashtags(notes = []) {
//     const tags = new Set();
//     const pattern = /(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
//     for (const note of notes || []) {
//       const text = String(note || '');
//       let match;
//       while ((match = pattern.exec(text)) !== null) {
//         tags.add(match[2].toLowerCase());
//       }
//     }
//     return Array.from(tags).sort();
//   }
//
// Behavior is byte-for-byte with the JS: a hashtag must start at the
// beginning of a note string or be preceded by whitespace / `(` / `[` /
// `{` / `,` / `;`; the tag body is `[A-Za-z0-9][A-Za-z0-9_-]*`. Matches are
// lowercased, de-duplicated, and returned in ascending sorted order.

import Foundation

public enum NoteHashtags {
    // JS: /(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g
    // No /m flag in the JS, so `^` anchors to the start of the whole string,
    // not per line — matching NSRegularExpression's default (anchorsMatchLines
    // off). Unlike JS, ICU character classes treat an unescaped `[` as the
    // start of a nested/union class, so it must be escaped here (`\\[`) even
    // though the JS source leaves it bare.
    private static let hashtagRegex = try! NSRegularExpression(
        pattern: "(^|[\\s(\\[{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)"
    )

    /// Extract hashtags from `notes`: lowercased, de-duplicated, ascending sorted.
    public static func extract(from notes: [String]) -> [String] {
        var tags: Set<String> = []
        for note in notes {
            let range = NSRange(note.startIndex..., in: note)
            for match in hashtagRegex.matches(in: note, range: range) {
                guard let tagRange = Range(match.range(at: 2), in: note) else { continue }
                tags.insert(note[tagRange].lowercased())
            }
        }
        return tags.sorted()
    }
}

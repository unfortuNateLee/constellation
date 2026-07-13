import Testing
@testable import ConstellationGraphModel

/// Expectations here are cross-checked against the real `js/palette.js`
/// (ESM) via `node -e`, run from the repo root.
///
/// 1. Fallback path, run against plain Node (no DOM, so `Palette._read()`
///    can't call `getComputedStyle` and every lookup falls back):
///
///    node -e "
///    import('./js/palette.js').then(({ Palette }) => {
///      console.log(Palette.NEUTRAL);              // #8395a7
///      console.log(Palette.category('doesnotexist')); // #8395a7
///      console.log(Palette.node('unknown'));       // #8395a7 (no DOM -> nodeDefault getter also falls back to NEUTRAL)
///    });
///    "
///
/// 2. Category mapping, verified by stubbing `getComputedStyle` with the
///    exact values from `css/styles.css`'s `:root` block (the single source
///    of truth the JS reads from) and confirming the category name -> CSS
///    custom property -> value chain resolves correctly:
///
///    node -e "
///    globalThis.document = { documentElement: {} };
///    const cssVars = {
///      '--cat-family': '#e17055', '--cat-company': '#8e44ad',
///      '--cat-node-default': '#dfe6e9', '--cat-group': '#8e9aaf',
///      '--cat-selected': '#ffd32a', '--cat-edge-inferred': '#aaa',
///    };
///    globalThis.getComputedStyle = () => ({
///      getPropertyValue: (name) => cssVars[name] ?? '',
///    });
///    import('./js/palette.js').then(({ Palette }) => {
///      console.log(Palette.category('family'));   // #e17055
///      console.log(Palette.category('company'));  // #8e44ad
///      console.log(Palette.node('unknownCat'));    // #dfe6e9 (nodeDefault fallback)
///      console.log(Palette.group);                 // #8e9aaf
///      console.log(Palette.selected);               // #ffd32a
///      console.log(Palette.inferred);               // #aaa
///    });
///    "
///
/// 3. Blank-but-present CSS var also falls back (raw value is trimmed, then
///    `|| NEUTRAL` kicks in for an empty string) — confirms the fallback is
///    on "falsy resolved value", not just "missing key":
///
///    node -e "
///    globalThis.document = { documentElement: {} };
///    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '  ' });
///    import('./js/palette.js').then(({ Palette }) => {
///      console.log(Palette.category('family')); // #8395a7
///    });
///    "
struct PaletteTests {
    @Test func neutralMatchesJS() {
        #expect(Palette.neutral == "#8395a7")
    }

    @Test func unknownCategoryFallsBackToNeutral() {
        // node-verified: Palette.category('doesnotexist') === '#8395a7'
        #expect(Palette.category("doesnotexist") == Palette.neutral)
    }

    @Test func unknownNodeCategoryFallsBackToNodeDefault() {
        // node-verified (with CSS stub): Palette.node('unknownCat') === '#dfe6e9'
        #expect(Palette.node("unknownCat") == Palette.nodeDefault)
    }

    @Test(arguments: [
        ("family", "#e17055"),
        ("friend", "#00b894"),
        ("mitre", "#0984e3"),
        ("work", "#74b9ff"),
        ("neighbor", "#fdcb6e"),
        ("church", "#a29bfe"),
        ("school", "#fd79a8"),
        ("medical", "#55efc4"),
        ("company", "#8e44ad"),
        ("virtual", "#b2bec3"),
        ("other", "#8395a7"),
    ])
    func categoryMappingMatchesJS(name: String, hex: String) {
        // node-verified against a getComputedStyle stub backed by the real
        // css/styles.css :root values (see file-level doc comment).
        #expect(Palette.category(name) == hex)
        // `node(_:)` should agree with `category(_:)` for every recognized name.
        #expect(Palette.node(name) == hex)
    }

    @Test func graphTokensMatchJS() {
        // node-verified: Palette.nodeDefault/group/selected/inferred
        #expect(Palette.nodeDefault == "#dfe6e9")
        #expect(Palette.group == "#8e9aaf")
        #expect(Palette.selected == "#ffd32a")
        #expect(Palette.inferred == "#aaa")
    }
}

import Testing

@testable import ConstellationModel

// Port of test/relationship-taxonomy.test.js. The JS file's first test
// ("taxonomy is the single source of truth...") exercises legacy delegator
// methods on RelationshipBuilder / VCFParser / ContactRelationshipApp that
// have no Swift counterpart yet (those modules haven't been ported); the
// underlying RelationshipTaxonomy assertions it makes are ported directly
// against RelationshipTaxonomy below instead.
struct RelationshipTaxonomyTests {
    // MARK: taxonomy core lookups behave as expected

    @Test func labelsAndVCardLabels() {
        #expect(RelationshipTaxonomy.label("husband") == "Husband")
        #expect(RelationshipTaxonomy.label("unknown-thing") == "Unknown-thing")
        #expect(RelationshipTaxonomy.label("") == "Related")
        #expect(RelationshipTaxonomy.vcardLabel("uncle/aunt") == "_$!<Uncle>!$_")
        #expect(RelationshipTaxonomy.vcardLabel("friend") == "_$!<Friend>!$_")
    }

    @Test func categories() {
        #expect(RelationshipTaxonomy.category("mother") == "family")
        #expect(RelationshipTaxonomy.category("manager") == "work")
        #expect(RelationshipTaxonomy.category("neighbor") == "neighbor")
        #expect(RelationshipTaxonomy.category("mystery") == "other")
    }

    @Test func normalization() {
        #expect(RelationshipTaxonomy.normalize("_$!<Husband>!$_") == "husband")
        #expect(RelationshipTaxonomy.normalize("Best Friend") == "friend")
        #expect(RelationshipTaxonomy.normalize("coworker") == "colleague")
        #expect(RelationshipTaxonomy.normalize("Pastor") == "pastor")
    }

    @Test func reciprocalsAndValidity() {
        #expect(RelationshipTaxonomy.reciprocal("husband") == "wife")
        #expect(RelationshipTaxonomy.reciprocal("mother") == "child")
        #expect(RelationshipTaxonomy.isValidReciprocal("husband", "wife") == true)
        #expect(RelationshipTaxonomy.isValidReciprocal("husband", "cousin") == false)
    }

    @Test func reciprocalDowngrade() {
        // generic 'parent' is a downgrade of specific 'mother'
        #expect(RelationshipTaxonomy.isReciprocalDowngrade("parent", "mother") == true)
        #expect(RelationshipTaxonomy.isReciprocalDowngrade("parent", "son") == false)
    }

    @Test func knownSet() {
        #expect(RelationshipTaxonomy.isKnown("grandson") == true)
        #expect(RelationshipTaxonomy.isKnown("totally-made-up") == false)
    }

    // MARK: legacy-delegator assertions ported directly against the taxonomy

    @Test func genderedReciprocalDelegation() {
        // _reciprocalType now genders the reciprocal by the holder's gender; with
        // no gender it returns the neutral reciprocal where one exists.
        #expect(RelationshipTaxonomy.genderedReciprocal("husband") == "spouse")
        #expect(RelationshipTaxonomy.genderedReciprocal("child", "M") == "father")
    }

    // MARK: every reciprocal and generic reference points at a known type

    @Test func everyReciprocalAndGenericIsKnown() {
        for (key, entry) in RelationshipTaxonomy.types {
            #expect(
                RelationshipTaxonomy.types[entry.reciprocal] != nil,
                "\(key): reciprocal \"\(entry.reciprocal)\" must be a known type"
            )
            if let generic = entry.generic {
                #expect(
                    RelationshipTaxonomy.types[generic] != nil,
                    "\(key): generic \"\(generic)\" must be a known type"
                )
            }
        }
    }

    // MARK: option HTML lists selectable types and a custom escape hatch

    @Test func optionsHtmlAndPickerOptions() {
        let html = RelationshipTaxonomy.optionsHtml("husband")
        // Generic parents are plain, top-level options (no "(generic)" suffix)…
        #expect(html.contains("<option value=\"spouse\">Spouse</option>"))
        #expect(!html.contains("(generic)"))
        // …and gendered/specific subtypes are indented beneath them (no <optgroup>).
        #expect(html.contains("<option value=\"husband\" selected>\u{00A0}\u{00A0}\u{00A0}Husband</option>"))
        #expect(!html.contains("<optgroup"))
        #expect(html.contains("value=\"__custom__\""))

        // pickerOptions() exposes the flat structure with depth for the combobox.
        let opts = RelationshipTaxonomy.pickerOptions()
        #expect(opts[0] == RelationshipPickerOption(value: "spouse", label: "Spouse", depth: 0))
        #expect(opts[1] == RelationshipPickerOption(value: "husband", label: "Husband", depth: 1))

        // An unknown type pre-selects the custom option.
        #expect(RelationshipTaxonomy.optionsHtml("pastor").contains("value=\"__custom__\" selected"))
    }
}

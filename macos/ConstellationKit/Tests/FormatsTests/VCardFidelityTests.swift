import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Ports of the vCard-owned tests from test/format-fidelity.test.js and both
// tests from test/vcard-param-escape.test.js.

@Suite struct VCardFidelityTests {
    // JS: vCard half of 'Gender (vCard GENDER) round-trips through vCard and Markdown'
    @Test func genderRoundTripsThroughVCard() {
        let parser = VCFParser()
        let m = parser.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Al\nN:;Al;;;\nGENDER:M\nEND:VCARD")[0]
        let f = parser.parse(
            "BEGIN:VCARD\nVERSION:3.0\nFN:Bo\nN:;Bo;;;\nGENDER:F;she\nEND:VCARD")[0]
        let o = parser.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Cy\nN:;Cy;;;\nGENDER:O\nEND:VCARD")[0]
        #expect(m.gender == "M")
        #expect(f.gender == "F")  // sex code before the ";text" component
        #expect(o.gender == "")

        #expect(VCardAdapter().serialize([m], ids: nil).contains("GENDER:M"))
    }

    // JS: 'X-ABLabel: Apple predefined labels are wrapped, custom labels stay plain'
    @Test func appleLabelsWrapCustomLabelsStayPlain() {
        #expect(VCardUtils.formatXABLabel("Other") == "_$!<Other>!$_")
        #expect(VCardUtils.formatXABLabel("School") == "_$!<School>!$_")
        #expect(VCardUtils.formatXABLabel("HomePage") == "_$!<HomePage>!$_")
        #expect(VCardUtils.formatXABLabel("a_custom_value") == "a_custom_value")
        #expect(VCardUtils.formatXABLabel("Soccer Team") == "Soccer Team")
    }

    // JS: 'a custom X-ABLabel on an edited phone serializes plain (no _$!<…>!$_)'
    @Test func customLabelOnPhoneSerializesPlain() {
        let contact = Contact(
            id: "c1", fn: "Label Test",
            phones: [LabeledValue(value: "5551234", types: [], label: "Bat Phone")])
        let out = VCardAdapter().serialize([contact], ids: nil)
        #expect(out.contains("X-ABLabel:Bat Phone"))
        #expect(!out.contains("_$!<Bat Phone>!$_"))
        let re = VCFParser().parse(out)[0]
        #expect(re.phones[0].label == "Bat Phone")
    }

    // JS: 'vCard export includes the photo for contacts without a raw card'
    @Test func exportIncludesPhotoWithoutRawCard() {
        let contact = Contact(
            id: "c1", fn: "Photo Person", photo: "data:image/jpeg;base64,/9j/AAAA")
        let out = VCardAdapter().serialize([contact], ids: nil)
        #expect(out.contains("PHOTO;ENCODING=b;TYPE=JPEG:/9j/AAAA"))
    }

    // JS: 'rewriting a card with GENDER does not duplicate the GENDER line'
    @Test func rewritingWithGenderDoesNotDuplicate() {
        var contact = VCFParser().parse(
            "BEGIN:VCARD\nVERSION:3.0\nFN:Gen\nN:;Gen;;;\nGENDER:M\nEND:VCARD")[0]
        contact.rawVCard = VCardSerializer.rewriteVCard(contact)
        contact.rawVCard = VCardSerializer.rewriteVCard(contact)
        let genderLines = (contact.rawVCard ?? "")
            .split(separator: /\r\n|\n/, omittingEmptySubsequences: false)
            .filter { $0.hasPrefix("GENDER:") }
        #expect(genderLines.count == 1)
    }

    // JS: 'editing a custom field updates its X-CONSTELLATION-FIELD line on rewrite'
    @Test func editingCustomFieldUpdatesItsLineOnRewrite() {
        let payload = #"{"key":"color","type":"string","value":"blue"}"#
            .replacingOccurrences(of: ",", with: "\\,")
        var contact = VCFParser().parse(
            "BEGIN:VCARD\nVERSION:3.0\nFN:CF\nN:;CF;;;\nX-CONSTELLATION-FIELD:\(payload)\nEND:VCARD"
        )[0]
        #expect(contact.customFields["color"]?.value == .string("blue"))

        contact.customFields["color"]?.value = .string("red")
        contact.rawVCard = VCardSerializer.rewriteVCard(contact)
        let re = VCFParser().parse(contact.rawVCard ?? "")[0]
        #expect(re.customFields["color"]?.value == .string("red"))
        let occurrences = (contact.rawVCard ?? "").components(
            separatedBy: "X-CONSTELLATION-FIELD"
        ).count - 1
        #expect(occurrences == 1)
    }

    // JS: 'encodeParamValue quotes values with structural characters'
    @Test func encodeParamValueQuotesStructuralCharacters() {
        #expect(VCardUtils.encodeParamValue("Skype") == "Skype")
        #expect(VCardUtils.encodeParamValue("a;b") == "\"a;b\"")
        #expect(VCardUtils.encodeParamValue("a:b") == "\"a:b\"")
        #expect(VCardUtils.encodeParamValue("a,b") == "\"a,b\"")
        #expect(VCardUtils.encodeParamValue("with space") == "\"with space\"")
        // DQUOTE and CR/LF are stripped before the quote check.
        #expect(VCardUtils.encodeParamValue("quo\"te") == "quote")
        #expect(VCardUtils.encodeParamValue("a\r\nb") == "ab")
    }

    // JS: 'vCard fallback serializer escapes IM/social param values'
    @Test func fallbackSerializerEscapesIMAndSocialParamValues() {
        let contact = Contact(
            id: "c1", fn: "Param Test",
            ims: [ImValue(value: "aim:handle", service: "Weird;Service", types: [])],
            socialProfiles: [
                SocialProfileValue(
                    url: "x-apple:handle", service: "Yelp:Pro", username: "u;v")
            ])
        let adapter = VCardAdapter()
        let out = adapter.serialize([contact], ids: nil)
        #expect(out.contains("X-SERVICE-TYPE=\"Weird;Service\""))
        #expect(out.contains("TYPE=\"Yelp:Pro\""))
        #expect(out.contains("X-USER=\"u;v\""))

        // And it reparses with the values intact (no structural corruption).
        let reparsed = adapter.parse(out, startIndex: 0)[0]
        #expect(reparsed.ims[0].service == "Weird;Service")
        #expect(reparsed.socialProfiles[0].service == "Yelp:Pro")
        #expect(reparsed.socialProfiles[0].username == "u;v")
    }
}

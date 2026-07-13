// DetailPlaceholderView — the read-only detail column. Shows the selected
// contact's photo/initials, display name, organization / title, and a few
// summary counts. With no selection it shows the "Select a contact" empty state.
// The full editable detail panel arrives in M5.

import ConstellationGraphModel
import ConstellationStore
import SwiftUI

struct DetailPlaceholderView: View {
    @Bindable var store: AppStore

    var body: some View {
        if let node = store.node(store.selectedContactID) {
            ContactSummary(node: node)
        } else {
            ContentUnavailableView(
                "Select a contact",
                systemImage: "person.crop.circle",
                description: Text("Choose a contact from the list to see its details."))
        }
    }
}

private struct ContactSummary: View {
    let node: GraphNode

    private var subtitle: String {
        [node.title, node.org].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                avatar
                VStack(spacing: 4) {
                    Text(node.name.isEmpty ? "Unnamed" : node.name)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    if !node.nickname.isEmpty {
                        Text("“\(node.nickname)”").foregroundStyle(.secondary)
                    }
                }

                Divider()

                VStack(spacing: 8) {
                    CountRow(icon: "envelope", label: "Emails", count: node.emails.count)
                    CountRow(icon: "phone", label: "Phones", count: node.phones.count)
                    CountRow(icon: "mappin.and.ellipse", label: "Addresses", count: node.addresses.count)
                    CountRow(
                        icon: "person.2", label: "Relationships",
                        count: node.related.count)
                    CountRow(icon: "number", label: "Tags", count: node.noteTags.count)
                }

                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .frame(minWidth: 220)
    }

    @ViewBuilder private var avatar: some View {
        if let image = imageFromDataURL(node.photo) {
            image.resizable().scaledToFill()
                .frame(width: 84, height: 84)
                .clipShape(Circle())
        } else {
            ZStack {
                Circle().fill(
                    ContactColors.primaryColor(filterTags: node.filterTags).opacity(0.25))
                Text(ContactColors.initials(for: node.name))
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 84, height: 84)
        }
    }
}

private struct CountRow: View {
    let icon: String
    let label: String
    let count: Int

    var body: some View {
        HStack {
            Label(label, systemImage: icon)
            Spacer()
            Text("\(count)").foregroundStyle(.secondary).monospacedDigit()
        }
        .font(.callout)
    }
}

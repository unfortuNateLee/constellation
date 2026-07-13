// SidebarView — search field, filter-tag chips, and the contact list.
//
// A read-only port of the web sidebar (js/app-sidebar.js): the list rows show the
// FilterEngine-formatted name, the organization sub-line, a photo thumbnail or
// initials avatar, and a category color dot; the chips are the store's available
// filter tags (js `_availableFilterTags`) with the same friendly labels and the
// AND-of-selection toggle behavior. Selection is bound to `store.selectedContactID`.

import ConstellationGraphModel
import ConstellationStore
import SwiftUI

struct SidebarView: View {
    @Bindable var store: AppStore

    /// Friendly labels for the system filter tags (js/app-sidebar.js
    /// `CATEGORY_LABELS`); hashtags render as `#tag`.
    private static let categoryLabels: [String: String] = [
        "family": "My Family",
        "company": "Company",
        "virtual": "Virtual",
        "other": "None",
    ]

    private func label(for tag: String) -> String {
        Self.categoryLabels[tag] ?? "#\(tag)"
    }

    /// Per-tag counts over all nodes (js/app-sidebar.js `_renderCategoryFilters`).
    private var tagCounts: [String: Int] {
        var counts: [String: Int] = [:]
        for node in store.graphModel.nodes {
            for tag in node.filterTags { counts[tag, default: 0] += 1 }
        }
        return counts
    }

    var body: some View {
        VStack(spacing: 0) {
            searchField
            if !store.allCategories.isEmpty {
                filterChips
                Divider()
            }
            contactList
        }
        .frame(minWidth: 240)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search contacts", text: $store.searchText)
                .textFieldStyle(.plain)
            if !store.searchText.isEmpty {
                Button {
                    store.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
    }

    private var filterChips: some View {
        ScrollView(.vertical) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 90), spacing: 6)],
                alignment: .leading, spacing: 6
            ) {
                ForEach(store.allCategories, id: \.self) { tag in
                    FilterChip(
                        label: label(for: tag),
                        count: tagCounts[tag] ?? 0,
                        color: ContactColors.tagColor(tag),
                        isActive: store.activeFilterTags.contains(tag),
                        isDisabled: tag == "family" && store.selfContactID == nil,
                        action: { store.toggleFilter(tag) })
                }
            }
            .padding(8)
        }
        .frame(maxHeight: 120)
    }

    private var contactList: some View {
        let contacts = store.filteredContacts
        return VStack(spacing: 0) {
            List(selection: $store.selectedContactID) {
                ForEach(contacts, id: \.id) { node in
                    ContactRow(node: node, sortMode: store.contactSortMode)
                        .tag(node.id)
                }
            }
            .listStyle(.sidebar)

            Divider()
            Text("\(contacts.count) contact\(contacts.count == 1 ? "" : "s")")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
        }
    }
}

/// One filter-tag chip.
private struct FilterChip: View {
    let label: String
    let count: Int
    let color: Color
    let isActive: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(label).lineLimit(1)
                Text("\(count)").foregroundStyle(.secondary)
            }
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isActive ? color.opacity(0.22) : Color.secondary.opacity(0.08)))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(isActive ? color : Color.clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .opacity(isDisabled ? 0.4 : 1)
        .help(isDisabled ? "Choose a \"me\" contact first to use My Family" : label)
    }
}

/// One contact-list row: avatar, name + organization sub-line, and a category dot.
private struct ContactRow: View {
    let node: GraphNode
    let sortMode: ContactSortMode

    private var displayName: String {
        FilterEngine.formatListName(
            fn: node.name, structured: node.structuredName, mode: sortMode)
    }

    var body: some View {
        HStack(spacing: 10) {
            avatar
            VStack(alignment: .leading, spacing: 1) {
                Text(displayName).lineLimit(1)
                if !node.org.isEmpty {
                    Text(node.org)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Circle()
                .fill(ContactColors.primaryColor(filterTags: node.filterTags))
                .frame(width: 9, height: 9)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var avatar: some View {
        if let image = imageFromDataURL(node.photo) {
            image.resizable().scaledToFill()
                .frame(width: 30, height: 30)
                .clipShape(Circle())
        } else {
            ZStack {
                Circle().fill(
                    ContactColors.primaryColor(filterTags: node.filterTags).opacity(0.25))
                Text(ContactColors.initials(for: displayName))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 30, height: 30)
        }
    }
}
